import Combine
import Foundation

@MainActor
final class StatusMonitor: ObservableObject {
    @Published var agents: [Agent] = []
    @Published var activeRuns: [Run] = []
    @Published private(set) var isDemoMode: Bool
    /// Full run list returned from the daemon, newest first. Used by the
    /// MainPane's Feed + Artifacts cards (which care about ALL recent runs,
    /// not just the ones currently running).
    @Published private(set) var recentRuns: [Run] = []
    /// Most recent completed/failed run per agent. Drives the sidebar's
    /// "failed last run" red indicator.
    @Published private(set) var lastRunByAgent: [String: Run] = [:]
    @Published private(set) var isServerReachable = false
    @Published var localAPISetupError: String?
    @Published var staleRunCount: Int = 0
    @Published private(set) var pendingDecisions: [Decision] = []
    @Published private(set) var decisionResolutionError: String?
    @Published var securityAnalyses: [String: SecurityAnalysisPayload] = [:]
    @Published var securityScanState = SecurityBackgroundScanState.idle
    @Published var securityDashboard: SecurityDashboardPresentation?
    @Published var securityScanFailure: ConsumerFlowFailure?

    let client = AgentServerClient()
    // Retained only for resolving decisions (a write, POSTed to the panel with
    // the API key). Reading pending decisions now comes from the local daemon,
    // which subscribes to Supabase Realtime and serves them over /decisions.
    // no panel polling, so zero Vercel cost.
    private var panelClient: PanelClient?
    private var timer: Timer?
    private let pollInterval: TimeInterval = 5
    private var pollTask: Task<Void, Never>?
    private var pollState = CoalescingRequestState()
    private var pollGeneration = 0
    private var decisionPollTask: Task<Void, Never>?
    private var decisionRefreshCoordinator = DecisionRefreshCoordinator()
    private var decisionResolutionTransaction = DecisionResolutionTransaction()
    private var decisionResolutionTasks: [String: Task<Void, Never>] = [:]
    var webSocketTask: URLSessionWebSocketTask?
    var webSocketSession: URLSession?
    var webSocketReconnectTask: Task<Void, Never>?
    var webSocketState = WebSocketReconnectState()
    var webSocketGeneration = 0
    var isMonitoring = false

    private weak var serverProcess: ServerProcessManager?
    var notificationManager: NotificationManager?
    private var consecutiveFailures = 0
    private static let restartThreshold = 3
    private var previousServerStartedAt: String?
    private var previousActiveRunIds: Set<String> = []
    /// Last-seen terminal status per runId, used to emit run_completed /
    /// run_failed exactly once as runs transition from active to terminal.
    private var reportedTerminalRuns = BoundedIdentifierHistory(limit: 2_000)
    private var reportedDecisionIds: Set<String> = []
    private var reportedAgentIds: Set<String> = []
    /// True after the very first poll completes. We use this to suppress
    /// telemetry on the initial snapshot. Otherwise every daemon restart
    /// would re-fire run_completed / run_failed / agent_discovered for the
    /// entire seeded history.
    private var hasDoneInitialPoll = false
    private var hasDoneInitialDecisionsPoll = false
    var securityAcknowledgements = SecurityAcknowledgementState()
    var debuggerPatches: [String: (patch: GuidanceConfigurationPatch, preview: GuidancePatchPreview)] = [:]
    var securityPatches: [String: (patch: GuidanceConfigurationPatch, preview: GuidancePatchPreview)] = [:]
    var securityScanTask: Task<Result<SecurityDashboardPresentation, ConsumerFlowFailure>, Never>?
    var lastBackgroundSecuritySignature: [String] = []

    private let demoModePreference: DemoModePreference
    private var liveAgents: [Agent] = []
    private var liveActiveRuns: [Run] = []
    private var liveRecentRuns: [Run] = []
    private var liveLastRunByAgent: [String: Run] = [:]
    private var liveServerReachable = false

    init(demoModePreference: DemoModePreference = DemoModePreference()) {
        self.demoModePreference = demoModePreference
        isDemoMode = demoModePreference.isEnabled
        if isDemoMode {
            presentDemoSnapshot()
        }
    }

    var demoModeState: DemoModeState {
        DemoModeState(isEnabled: isDemoMode)
    }

    func toggleDemoMode() {
        setDemoModeEnabled(!isDemoMode)
    }

    func demoRuns(for agentId: String) -> [Run]? {
        guard isDemoMode else { return nil }
        return recentRuns.filter { $0.agentId == agentId }
    }

    private func setDemoModeEnabled(_ isEnabled: Bool) {
        demoModePreference.setEnabled(isEnabled)
        isDemoMode = isEnabled
        if isEnabled {
            presentDemoSnapshot()
        } else {
            presentLiveSnapshot()
        }
    }

    private func presentDemoSnapshot() {
        let startOfToday = Calendar.current.startOfDay(for: Date())
        let fixtures = DemoModeFixtures.make(
            referenceDate: startOfToday.addingTimeInterval(12 * 3_600)
        )
        agents = fixtures.presentedAgents
        recentRuns = fixtures.presentedRuns.sorted { $0.startedAt > $1.startedAt }
        activeRuns = recentRuns.filter(\.isActive)
        lastRunByAgent = latestTerminalRuns(from: recentRuns)
        isServerReachable = true
        localAPISetupError = nil
    }

    private func presentLiveSnapshot() {
        agents = liveAgents
        activeRuns = liveActiveRuns
        recentRuns = liveRecentRuns
        lastRunByAgent = liveLastRunByAgent
        isServerReachable = liveServerReachable
    }

    private func latestTerminalRuns(from runs: [Run]) -> [String: Run] {
        var latest: [String: Run] = [:]
        for run in runs where !run.isActive {
            if let existing = latest[run.agentId], existing.startedAt >= run.startedAt {
                continue
            }
            latest[run.agentId] = run
        }
        return latest
    }

    func setServerProcess(_ manager: ServerProcessManager) {
        self.serverProcess = manager
    }

    func setNotificationManager(_ manager: NotificationManager) {
        self.notificationManager = manager
    }

    func start() {
        guard !isMonitoring else { return }
        isMonitoring = true
        poll()
        pollDecisions()
        connectWebSocket()
        // Decisions ride the same 5s cadence as runs, but the call is local
        // (to the daemon), so it costs nothing on the panel side.
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.poll()
                self?.pollDecisions()
            }
        }
    }

    func stop() {
        isMonitoring = false
        pollGeneration += 1
        pollTask?.cancel()
        pollTask = nil
        pollState.reset()
        decisionRefreshCoordinator.stop()
        decisionPollTask?.cancel()
        decisionPollTask = nil
        cancelDecisionResolutions()
        timer?.invalidate()
        timer = nil
        disconnectWebSocket()
    }

    // MARK: - Decisions polling

    func pollDecisions() {
        guard isMonitoring else { return }
        guard let token = decisionRefreshCoordinator.requestRefresh() else { return }
        startDecisionRefresh(token)
    }

    func resolveDecision(id: String, body: DecisionResolveBody) {
        if panelClient == nil {
            panelClient = PanelClient.fromEnv()
        }
        guard let panelClient else {
            decisionResolutionError = DecisionResolutionFeedback.failureMessage
            return
        }
        guard let token = decisionResolutionTransaction.begin(decisionId: id) else { return }
        updateDecisionResolutionError()

        decisionResolutionTasks[id] = Task { [weak self] in
            let succeeded: Bool
            do {
                try await panelClient.resolveDecision(id: id, body: body)
                succeeded = true
            } catch {
                succeeded = false
            }
            self?.finishDecisionResolution(token, succeeded: succeeded)
        }
    }

    private func finishDecisionResolution(
        _ token: DecisionResolutionTransaction.Token,
        succeeded: Bool
    ) {
        guard let shouldCommit = decisionResolutionTransaction.finish(
            token,
            succeeded: succeeded
        ) else { return }

        decisionResolutionTasks[token.decisionId] = nil
        updateDecisionResolutionError()
        guard shouldCommit else { return }
        pendingDecisions.removeAll { $0.id == token.decisionId }
        Telemetry.capture(
            "decision_resolved",
            properties: ["decision_id": token.decisionId]
        )
        pollDecisions()
    }

    private func cancelDecisionResolutions() {
        decisionResolutionTransaction.cancelAll()
        updateDecisionResolutionError()
        decisionResolutionTasks.values.forEach { $0.cancel() }
        decisionResolutionTasks.removeAll()
    }

    private func updateDecisionResolutionError() {
        decisionResolutionError = decisionResolutionTransaction.hasFailures
            ? DecisionResolutionFeedback.failureMessage
            : nil
    }

    private func startDecisionRefresh(_ token: DecisionRefreshCoordinator.Token) {
        let client = client
        decisionPollTask = Task { [weak self] in
            do {
                let decisions = try await client.fetchPendingDecisions()
                guard let self, !Task.isCancelled else { return }
                self.finishDecisionRefresh(token, decisions: decisions)
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.finishDecisionRefresh(token, decisions: nil)
            }
        }
    }

    private func finishDecisionRefresh(
        _ token: DecisionRefreshCoordinator.Token,
        decisions: [Decision]?
    ) {
        let completion = decisionRefreshCoordinator.finishRefresh(token)
        guard completion.shouldApply else { return }

        if let decisions {
            applyDecisionSnapshot(decisions)
        }

        if let followUp = completion.followUp {
            startDecisionRefresh(followUp)
        } else {
            decisionPollTask = nil
        }
    }

    private func applyDecisionSnapshot(_ decisions: [Decision]) {
        let ids = Set(decisions.map(\.id))
        if hasDoneInitialDecisionsPoll {
            for newDecision in ids.subtracting(reportedDecisionIds) {
                Telemetry.capture("decision_emitted", properties: ["decision_id": newDecision])
            }
        }
        reportedDecisionIds = ids
        hasDoneInitialDecisionsPoll = true
        pendingDecisions = decisions
    }

    // Inject decisions directly (used by tests and realtime push paths).
    func setPendingDecisions(_ decisions: [Decision]) {
        self.pendingDecisions = decisions
    }

    func poll() {
        guard pollState.request() else { return }
        pollGeneration += 1
        let generation = pollGeneration

        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.performPoll()
                guard !Task.isCancelled, generation == self.pollGeneration else { return }
                guard self.pollState.complete() else {
                    self.pollTask = nil
                    return
                }
            }
        }
    }

    private func performPoll() async {
        do {
            let health = try await client.health()
            liveServerReachable = true
            if !isDemoMode { isServerReachable = true }
            consecutiveFailures = 0

            let fetchedAgents = try await client.agents()
            localAPISetupError = nil
            let fetchedRuns = try await client.runs()

            self.liveAgents = fetchedAgents
            if !self.isDemoMode { self.agents = fetchedAgents }

                let currentActiveRuns = fetchedRuns.filter { $0.isActive }

                if let serverStartedAt = health.startedAt {
                    if let previous = self.previousServerStartedAt,
                       previous != serverStartedAt {
                        if !self.previousActiveRunIds.isEmpty {
                            self.staleRunCount = self.previousActiveRunIds.count
                        }
                        self.notificationManager?.notifyServerRestarted()
                        self.resetWebSocketConnection()
                    }
                    self.previousServerStartedAt = serverStartedAt
                }

                let newActiveIds = Set(currentActiveRuns.map { $0.runId })
                if self.hasDoneInitialPoll {
                    for newlyStarted in newActiveIds.subtracting(self.previousActiveRunIds) {
                        Telemetry.capture("run_started", properties: ["run_id": newlyStarted])
                    }
                }
                self.previousActiveRunIds = newActiveIds
                self.liveActiveRuns = currentActiveRuns
                self.liveRecentRuns = fetchedRuns.sorted { $0.startedAt > $1.startedAt }
                if !self.isDemoMode {
                    self.activeRuns = currentActiveRuns
                    self.recentRuns = self.liveRecentRuns
                }

                for run in fetchedRuns where !run.isActive {
                    guard self.reportedTerminalRuns.insert(run.runId) else { continue }
                    // Suppress telemetry on the first poll. Those are runs
                    // seeded from panel history, not events that just happened
                    // on this daemon. Only emit for transitions observed in
                    // subsequent polls.
                    guard self.hasDoneInitialPoll else { continue }
                    switch run.status {
                    case .completed:
                        Telemetry.capture("run_completed", properties: ["run_id": run.runId])
                    case .failed:
                        Telemetry.capture("run_failed", properties: ["run_id": run.runId])
                    case .running, .skipped:
                        break
                    }
                }

                let agentIds = Set(fetchedAgents.map { $0.id })
                if self.hasDoneInitialPoll {
                    for newAgent in agentIds.subtracting(self.reportedAgentIds) {
                        Telemetry.capture("agent_discovered", properties: ["agent_id": newAgent])
                    }
                }
                self.reportedAgentIds = agentIds
                self.hasDoneInitialPoll = true

                // Show the latest attempt that produced an agent outcome.
                // A lock-contention retry never started, so it must not replace
                // the original run when that run later completes.
                var latest: [String: Run] = [:]
                let runsByAgent = Dictionary(grouping: fetchedRuns, by: \.agentId)
                for (agentId, agentRuns) in runsByAgent {
                    let candidates = agentRuns.map {
                        RunOutcomeCandidate(
                            id: $0.runId,
                            startedAt: $0.startedAt,
                            status: $0.status.rawValue,
                            code: $0.code
                        )
                    }
                    guard let outcome = RunOutcomeSelection.latestMeaningfulRun(in: candidates),
                          let run = agentRuns.first(where: { $0.runId == outcome.id }) else {
                        continue
                    }
                    latest[agentId] = run
                }
            self.liveLastRunByAgent = latest
            if !self.isDemoMode { self.lastRunByAgent = latest }
        } catch {
            guard !Task.isCancelled else { return }
            handlePollFailure(error)
        }
    }

    private func handlePollFailure(_ error: Error) {
        let failureKind: MonitorPollFailureKind
        if let clientError = error as? ClientError,
           case .missingLocalAPIKey = clientError {
            failureKind = .authenticationSetup
        } else {
            failureKind = MonitorPollFailureClassifier.kind(for: error)
        }

        switch failureKind {
        case .reachability:
            liveServerReachable = false
            liveActiveRuns = []
            guard !isDemoMode else { return }
            localAPISetupError = nil
            isServerReachable = false
            activeRuns = []
            consecutiveFailures += 1
            if consecutiveFailures == Self.restartThreshold {
                autoRestartServer()
            }
        case .authenticationSetup:
            liveServerReachable = true
            guard !isDemoMode else { return }
            isServerReachable = true
            consecutiveFailures = 0
            localAPISetupError = Self.localAPISetupMessage
        case .responseSchema, .serverResponse:
            liveServerReachable = true
            guard !isDemoMode else { return }
            // The daemon answered. Restarting it cannot repair an incompatible
            // response shape or a valid HTTP error, and can create a loop that
            // hides the real problem from the user.
            isServerReachable = true
            consecutiveFailures = 0
        }
    }

    static let localAPISetupMessage =
        "Secure local setup is incomplete. Restart Agent Server and try again."

    private func autoRestartServer() {
        guard let serverProcess else { return }
        print("[StatusMonitor] Server unreachable after \(Self.restartThreshold) checks, restarting...")
        Task {
            await serverProcess.startIfNeeded()
            surfaceServerProcessError(from: serverProcess)
        }
    }

    func requestServerRestart() {
        guard let serverProcess else { return }
        disconnectWebSocket()
        Task {
            await serverProcess.restart()
            surfaceServerProcessError(from: serverProcess)
            resetWebSocketConnection()
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            poll()
        }
    }

    func workspaceDidChange() {
        cancelDecisionResolutions()
        panelClient = nil
        requestServerRestart()
    }

    private func surfaceServerProcessError(from serverProcess: ServerProcessManager) {
        guard let error = serverProcess.lastError else { return }
        localAPISetupError = error.localizedDescription
    }

}
