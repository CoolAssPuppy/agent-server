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
    @Published private(set) var localAPISetupError: String?
    @Published var staleRunCount: Int = 0
    @Published private(set) var pendingDecisions: [Decision] = []
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
    private var webSocketTask: URLSessionWebSocketTask?
    private var webSocketSession: URLSession?
    private var webSocketDelegate: WebSocketOpenDelegate?
    private var webSocketReconnectTask: Task<Void, Never>?
    private var webSocketState = WebSocketReconnectState()
    private var webSocketGeneration = 0
    private var isMonitoring = false

    private weak var serverProcess: ServerProcessManager?
    private var notificationManager: NotificationManager?
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
        timer?.invalidate()
        timer = nil
        disconnectWebSocket()
    }

    // MARK: - Decisions polling

    func pollDecisions() {
        Task { [weak self] in
            guard let self else { return }
            do {
                let decisions = try await self.client.fetchPendingDecisions()
                let ids = Set(decisions.map { $0.id })
                if self.hasDoneInitialDecisionsPoll {
                    for newDecision in ids.subtracting(self.reportedDecisionIds) {
                        Telemetry.capture("decision_emitted", properties: ["decision_id": newDecision])
                    }
                }
                self.reportedDecisionIds = ids
                self.hasDoneInitialDecisionsPoll = true
                self.pendingDecisions = decisions
            } catch {
                // Silently ignore and keep the previous list until the next poll succeeds.
            }
        }
    }

    func resolveDecision(id: String, body: DecisionResolveBody) {
        Telemetry.capture("decision_resolved", properties: ["decision_id": id])
        // Optimistic removal.
        pendingDecisions.removeAll { $0.id == id }
        if panelClient == nil {
            panelClient = PanelClient.fromEnv()
        }
        guard let panelClient else { return }
        Task { [weak self] in
            do {
                try await panelClient.resolveDecision(id: id, body: body)
            } catch {
                // On failure, refetch to restore state.
                self?.pollDecisions()
            }
        }
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

                // Latest TERMINAL run per agent (for sidebar failed/succeeded
                // indicator). Running runs are excluded so the icon reflects
                // the previous outcome, not the in-flight attempt.
                var latest: [String: Run] = [:]
                for run in fetchedRuns where !run.isActive {
                    if let existing = latest[run.agentId] {
                        if run.startedAt > existing.startedAt { latest[run.agentId] = run }
                    } else {
                        latest[run.agentId] = run
                    }
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

    private static let localAPISetupMessage =
        "Secure local setup is incomplete. Restart Agent Server and try again."

    private func autoRestartServer() {
        guard let serverProcess else { return }
        print("[StatusMonitor] Server unreachable after \(Self.restartThreshold) checks, restarting...")
        Task {
            await serverProcess.startIfNeeded()
        }
    }

    func requestServerRestart() {
        guard let serverProcess else { return }
        disconnectWebSocket()
        Task {
            await serverProcess.restart()
            resetWebSocketConnection()
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            poll()
        }
    }

    func workspaceDidChange() {
        panelClient = nil
        requestServerRestart()
    }

    func triggerRun(agentId: String) async -> AgentRunTriggerState {
        guard !isDemoMode else { return .failure(.generic) }
        do {
            let response = try await client.triggerRun(agentId: agentId)
            poll()
            return .started(runId: response.runId)
        } catch {
            return .failure(runTriggerFailure(for: error))
        }
    }

    private func runTriggerFailure(for error: Error) -> AgentRunTriggerFailure {
        if case let ClientError.runTriggerFailed(message, code, missingEnv) = error {
            return .classify(
                serverCode: code,
                serverMessage: message,
                hasMissingConnection: !missingEnv.isEmpty
            )
        }

        let isTransportFailure = error is URLError
            || (error as NSError).domain == NSURLErrorDomain
        return .classify(
            serverCode: nil,
            isTransportFailure: isTransportFailure
        )
    }

    // MARK: - WebSocket

    private func connectWebSocket() {
        guard isMonitoring, webSocketTask == nil else { return }
        guard let url = LocalServerEndpoint.webSocketURL(port: 47821) else { return }
        guard let request = try? LocalAPIAuthentication.authenticatedRequest(
            URLRequest(url: url)
        ) else {
            // Secure local setup may still be in progress. Keep retrying so a
            // key written by the daemon is picked up without relaunching.
            localAPISetupError = Self.localAPISetupMessage
            scheduleWebSocketReconnect()
            return
        }
        webSocketGeneration += 1
        let generation = webSocketGeneration
        webSocketState.startedConnecting()

        let delegate = WebSocketOpenDelegate { [weak self] in
            Task { @MainActor [weak self] in
                guard let self,
                      generation == self.webSocketGeneration,
                      self.webSocketTask != nil else { return }
                self.webSocketState.confirmedOpen()
                self.localAPISetupError = nil
            }
        }
        let session = URLSession(
            configuration: .default,
            delegate: delegate,
            delegateQueue: nil
        )
        let task = session.webSocketTask(with: request)
        webSocketSession = session
        webSocketDelegate = delegate
        webSocketTask = task
        task.resume()
        receiveWebSocketMessage(generation: generation)
    }

    private func disconnectWebSocket() {
        webSocketGeneration += 1
        webSocketReconnectTask?.cancel()
        webSocketReconnectTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil
        webSocketDelegate = nil
        webSocketState.reset()
    }

    private func resetWebSocketConnection() {
        disconnectWebSocket()
        connectWebSocket()
    }

    private func receiveWebSocketMessage(generation: Int) {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, generation == self.webSocketGeneration else { return }

                switch result {
                case .success(let message):
                    // A received frame is also confirmation for platforms that
                    // deliver it before the delegate's open callback.
                    self.webSocketState.confirmedOpen()
                    self.handleWebSocketMessage(message)
                    self.receiveWebSocketMessage(generation: generation)
                case .failure:
                    self.webSocketTask = nil
                    self.webSocketSession?.invalidateAndCancel()
                    self.webSocketSession = nil
                    self.webSocketDelegate = nil
                    self.scheduleWebSocketReconnect()
                }
            }
        }
    }

    private func handleWebSocketMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let event = try? JSONDecoder().decode(ProgressEvent.self, from: data) else { return }

            switch event.type {
            case .runStarted:
                poll()
            case .runCompleted:
                notificationManager?.notifyRunCompleted(
                    agentName: agentName(for: event.agentId),
                    summary: event.summary
                )
                poll()
            case .runFailed:
                if event.code == "run_timeout" {
                    notificationManager?.notifyRunTimedOut(
                        agentName: agentName(for: event.agentId)
                    )
                } else {
                    notificationManager?.notifyRunFailed(
                        agentName: agentName(for: event.agentId),
                        error: event.error ?? event.message
                    )
                }
                poll()
            case .mcpStatus:
                let needsAuth = event.mcpNeedsAuthServers ?? []
                if !needsAuth.isEmpty {
                    notificationManager?.notifyMcpNeedsAuth(serverNames: needsAuth)
                }
            case .runProgress, .unknown:
                break
            }
        case .data:
            break
        @unknown default:
            break
        }
    }

    private func agentName(for agentId: String) -> String {
        agents.first(where: { $0.id == agentId })?.name ?? agentId
    }

    private func scheduleWebSocketReconnect() {
        guard isMonitoring, webSocketReconnectTask == nil else { return }
        let delay = webSocketState.recordFailure()
        let nanoseconds = UInt64(delay * 1_000_000_000)

        webSocketReconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled, let self else { return }
            self.webSocketReconnectTask = nil
            self.connectWebSocket()
        }
    }
}

private final class WebSocketOpenDelegate: NSObject, URLSessionWebSocketDelegate {
    private let onOpen: @Sendable () -> Void

    init(onOpen: @escaping @Sendable () -> Void) {
        self.onOpen = onOpen
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        onOpen()
    }
}

enum ProgressEventType: String, Decodable {
    case runStarted = "run_started"
    case runProgress = "run_progress"
    case runCompleted = "run_completed"
    case runFailed = "run_failed"
    case mcpStatus = "mcp_status"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ProgressEventType(rawValue: raw) ?? .unknown
    }
}

struct ProgressEvent: Decodable {
    let type: ProgressEventType
    let runId: String
    let agentId: String
    let timestamp: String
    let message: String?
    let error: String?
    let summary: String?
    let code: String?
    let mcpNeedsAuthServers: [String]?

    enum CodingKeys: String, CodingKey {
        case type, runId, agentId, timestamp, message, error, summary, code
        case mcpNeedsAuthServers = "mcp_needs_auth_servers"
    }
}
