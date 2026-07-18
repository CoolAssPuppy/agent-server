import Combine
import Foundation

@MainActor
final class StatusMonitor: ObservableObject {
    @Published private(set) var agents: [Agent] = []
    @Published private(set) var activeRuns: [Run] = []
    /// Full run list returned from the daemon, newest first. Used by the
    /// MainPane's Feed + Artifacts cards (which care about ALL recent runs,
    /// not just the ones currently running).
    @Published private(set) var recentRuns: [Run] = []
    /// Most recent completed/failed run per agent. Drives the sidebar's
    /// "failed last run" red indicator.
    @Published private(set) var lastRunByAgent: [String: Run] = [:]
    @Published private(set) var isServerReachable = false
    @Published private(set) var localAPISetupError: String?
    @Published private(set) var staleRunCount: Int = 0
    @Published private(set) var pendingDecisions: [Decision] = []
    @Published private(set) var securityAnalyses: [String: SecurityAnalysisPayload] = [:]

    private let client = AgentServerClient()
    // Retained only for resolving decisions (a write, POSTed to the panel with
    // the API key). Reading pending decisions now comes from the local daemon,
    // which subscribes to Supabase Realtime and serves them over /decisions —
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
    private var reportedTerminalRuns: Set<String> = []
    private var reportedDecisionIds: Set<String> = []
    private var reportedAgentIds: Set<String> = []
    /// True after the very first poll completes. We use this to suppress
    /// telemetry on the initial snapshot — otherwise every daemon restart
    /// would re-fire run_completed / run_failed / agent_discovered for the
    /// entire seeded history.
    private var hasDoneInitialPoll = false
    private var hasDoneInitialDecisionsPoll = false
    private var securityAcknowledgements = SecurityAcknowledgementState()
    private var debuggerPatches: [String: (patch: GuidanceConfigurationPatch, preview: GuidancePatchPreview)] = [:]

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
                // Silently ignore — keep previous list until next poll succeeds.
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
            isServerReachable = true
            consecutiveFailures = 0

            let fetchedAgents = try await client.agents()
            localAPISetupError = nil
            let fetchedRuns = try await client.runs()

            self.agents = fetchedAgents

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
                self.activeRuns = currentActiveRuns
                self.recentRuns = fetchedRuns.sorted { $0.startedAt > $1.startedAt }

                for run in fetchedRuns where !run.isActive {
                    guard !self.reportedTerminalRuns.contains(run.runId) else { continue }
                    self.reportedTerminalRuns.insert(run.runId)
                    // Suppress telemetry on the first poll — those are runs
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
            self.lastRunByAgent = latest
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
            localAPISetupError = nil
            isServerReachable = false
            activeRuns = []
            consecutiveFailures += 1
            if consecutiveFailures == Self.restartThreshold {
                autoRestartServer()
            }
        case .authenticationSetup:
            isServerReachable = true
            consecutiveFailures = 0
            localAPISetupError = Self.localAPISetupMessage
        case .responseSchema, .serverResponse:
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

    func triggerRun(agentId: String) {
        Task {
            do {
                let _ = try await client.triggerRun(agentId: agentId)
                poll()
            } catch {
                // Run trigger failed silently; next poll will show current state
            }
        }
    }

    // MARK: - Agent writes

    /// Outcome of an agent write, shaped for the consumer UI: missing env
    /// vars trigger the Connect flow rather than a bare error string.
    enum AgentWriteOutcome: Equatable {
        case success
        case missingEnv([String])
        case failure(String)
    }

    private func writeOutcome(for error: Error) -> AgentWriteOutcome {
        if let clientError = error as? ClientError, !clientError.missingEnvVars.isEmpty {
            return .missingEnv(clientError.missingEnvVars)
        }
        return .failure(error.localizedDescription)
    }

    /// Applies a structured patch through the server's write API and swaps
    /// the returned agent into the published list so the UI updates without
    /// waiting for the next poll.
    @discardableResult
    func updateAgent(id: String, patch: [String: Any]) async -> AgentWriteOutcome {
        do {
            let updated = try await client.updateAgent(id: id, patch: patch)
            if let index = agents.firstIndex(where: { $0.id == updated.id }) {
                agents[index] = updated
            }
            return .success
        } catch {
            return writeOutcome(for: error)
        }
    }

    @discardableResult
    func setCapability(agentId: String, capabilityId: String, enabled: Bool) async -> AgentWriteOutcome {
        do {
            let updated = try await client.setCapability(
                agentId: agentId,
                capabilityId: capabilityId,
                enabled: enabled
            )
            if let index = agents.firstIndex(where: { $0.id == updated.id }) {
                agents[index] = updated
            }
            return .success
        } catch {
            return writeOutcome(for: error)
        }
    }

    func createAgent(
        name: String,
        description: String?,
        prompt: String,
        schedule: String?,
        capabilities: [(id: String, enabled: Bool)]
    ) async -> Result<Agent, Error> {
        do {
            let created = try await client.createAgent(
                name: name,
                description: description,
                prompt: prompt,
                schedule: schedule,
                capabilities: capabilities
            )
            poll()
            return .success(created)
        } catch {
            return .failure(error)
        }
    }

    @discardableResult
    func deleteAgent(id: String) async -> AgentWriteOutcome {
        do {
            try await client.deleteAgent(id: id)
            agents.removeAll { $0.id == id }
            poll()
            return .success
        } catch {
            return writeOutcome(for: error)
        }
    }

    /// Full capability catalog for the new-agent flow. Empty on failure —
    /// the sheet degrades to name/prompt/schedule only.
    func capabilityCatalog() async -> [CapabilityCatalogEntry] {
        (try? await client.capabilityCatalog()) ?? []
    }

    /// The cached connectors the Claude runtime can reach. Empty snapshot on
    /// failure so the Connections screen degrades gracefully.
    func connections() async -> ConnectionSnapshot {
        (try? await client.connections()) ?? .empty
    }

    /// Forces a fresh discovery probe (the "Refresh connections" action).
    func refreshConnections() async -> ConnectionSnapshot {
        (try? await client.refreshConnections()) ?? .empty
    }

    // MARK: - Guided creation and debugging

    func prepareGuidedAgent(
        request: String,
        answers: [String: String]
    ) async -> Result<CreationPreparation, ConsumerFlowFailure> {
        do {
            let snapshot = try await client.connections()
            let connectedServices = snapshot.servers
                .filter(\.isConnected)
                .map { $0.displayName.lowercased() }
            let answerPayloads = answers.sorted(by: { $0.key < $1.key }).map {
                GuidanceProposalAnswer(questionId: $0.key, value: Self.guidanceValue($0.value))
            }
            let response = try await client.createGuidedProposal(GuidanceProposalRequest(
                request: request,
                timezone: TimeZone.current.identifier,
                connectedServices: connectedServices,
                answers: answerPayloads
            ))
            switch response {
            case .proposal(let review): return .success(.proposal(review.presentation))
            case .needsInformation(let questions, _): return .success(.questions(questions))
            }
        } catch {
            return .failure(guidanceFailure(
                title: "Could not prepare your agent",
                message: "The local creation service did not finish the proposal.",
                recovery: "Make sure Agent Server and Codex are available, then try again.",
                error: error
            ))
        }
    }

    func saveGuidedAgent(
        proposal: AgentProposalPresentation,
        runSafeTest: Bool
    ) async -> Result<SavedAgentPresentation, ConsumerFlowFailure> {
        guard let reviewId = proposal.reviewId else {
            return .failure(guidanceFailure(
                title: "Review this proposal again",
                message: "The proposal no longer has a valid review record.",
                recovery: "Go back and prepare the proposal again before saving.",
                error: ClientError.invalidResponse
            ))
        }
        do {
            let response = try await client.saveGuidedProposal(id: reviewId)
            guard response.saved else { throw ClientError.invalidResponse }
            poll()
            guard runSafeTest else {
                return .success(SavedAgentPresentation(agentId: response.agent.id, safeTestRunId: nil))
            }
            do {
                let runId = try await client.triggerSafeTest(agentId: response.agent.id).runId
                return .success(SavedAgentPresentation(agentId: response.agent.id, safeTestRunId: runId))
            } catch {
                return .failure(ConsumerFlowFailure(
                    title: "Agent saved, but the test did not start",
                    message: "Your reviewed agent is saved locally.",
                    recovery: "Open the agent to check its connections, then run a safe test again.",
                    technicalDetails: error.localizedDescription,
                    didSave: true,
                    canRetry: true
                ))
            }
        } catch {
            return .failure(ConsumerFlowFailure(
                title: "Could not save your agent",
                message: "The reviewed agent was not fully saved.",
                recovery: "Check the server and any required connections, then try again.",
                technicalDetails: error.localizedDescription,
                didSave: false,
                canRetry: true
            ))
        }
    }

    func diagnoseRun(id: String) async -> Result<DiagnosticPresentation, ConsumerFlowFailure> {
        do {
            let diagnosis = try await client.diagnoseRun(id: id)
            guard let patch = diagnosis.validatedPatch else {
                debuggerPatches[id] = nil
                return .success(diagnosis.presentation)
            }
            let preview = try await client.previewGuidancePatch(patch)
            if preview.canApply {
                debuggerPatches[id] = (patch, preview)
            } else {
                debuggerPatches[id] = nil
            }
            return .success(diagnosis.presentation(with: preview))
        } catch {
            return .failure(guidanceFailure(
                title: "Could not explain this run",
                message: "The local debugger could not finish its checks.",
                recovery: "Make sure the run still exists and the server is available, then try again.",
                error: error
            ))
        }
    }

    func applyDebuggerFix(runId: String) async -> Result<Void, ConsumerFlowFailure> {
        guard let context = debuggerPatches[runId], context.preview.canApply else {
            return .failure(guidanceFailure(
                title: "This fix cannot be applied",
                message: "The server did not provide a current validated change.",
                recovery: "Run the diagnosis again before changing the agent.",
                error: ClientError.invalidResponse
            ))
        }
        do {
            let patch = context.preview.requiresConfirmation
                ? context.patch.confirming(previewContentHash: context.preview.resultContentHash)
                : context.patch
            _ = try await client.applyGuidancePatch(patch)
            poll()
            return .success(())
        } catch {
            return .failure(guidanceFailure(
                title: "Could not apply the reviewed fix",
                message: "No unreviewed change was applied.",
                recovery: "The agent may have changed. Diagnose the run again, then retry.",
                error: error
            ))
        }
    }

    func retryRun(id: String) async -> Result<String, ConsumerFlowFailure> {
        do {
            let response = try await client.retryGuidedRun(id: id)
            poll()
            return .success(response.runId)
        } catch {
            return .failure(guidanceFailure(
                title: "Could not start the retry",
                message: "The original failed run is still preserved.",
                recovery: "Check the server and required connections, then try again.",
                error: error
            ))
        }
    }

    private static func guidanceValue(_ value: String) -> GuidanceProposalAnswerValue {
        switch value.lowercased() {
        case "yes": return .boolean(true)
        case "no": return .boolean(false)
        default: return .string(value)
        }
    }

    private func guidanceFailure(
        title: String,
        message: String,
        recovery: String,
        error: Error
    ) -> ConsumerFlowFailure {
        ConsumerFlowFailure(
            title: title,
            message: message,
            recovery: recovery,
            technicalDetails: error.localizedDescription,
            didSave: false,
            canRetry: true
        )
    }

    // MARK: - Security analysis

    func scanAllSecurity() async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure> {
        do {
            let payload = try await client.scanSecurity()
            securityAnalyses = Dictionary(
                payload.analyses.map { ($0.agentId, $0) },
                uniquingKeysWith: { _, newest in newest }
            )
            let names = Dictionary(agents.map { ($0.id, $0.name) }, uniquingKeysWith: { _, newest in newest })
            return .success(payload.presentation(agentNames: names))
        } catch {
            return .failure(securityFailure(
                title: "Could not check your agents",
                error: error,
                recovery: "Make sure the local server is running, then try again."
            ))
        }
    }

    func analyzeSecurity(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        do {
            let analysis = try await client.securityAnalysis(agentId: agentId)
            securityAnalyses[agentId] = analysis
            return .success(securityPresentation(analysis))
        } catch {
            return .failure(securityFailure(
                title: "Could not check this agent",
                error: error,
                recovery: "Check that the agent still exists, then try again."
            ))
        }
    }

    func markSecurityReviewed(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let analysis = securityAnalyses[agentId] else {
            return .failure(securityFailure(
                title: "Run the security check first",
                error: ClientError.invalidResponse,
                recovery: "Check this agent again before marking it reviewed."
            ))
        }
        do {
            let response = try await client.markSecurityReviewed(
                agentId: agentId,
                contentHash: analysis.contentHash,
                acknowledgedFindingIds: analysis.findings.map(\.id)
            )
            guard response.reviewed else { throw ClientError.invalidResponse }
            return .success(securityPresentation(
                analysis,
                reviewedAt: response.reviewState?.reviewedDate ?? Date(),
                isStale: response.reviewState?.isStale ?? false
            ))
        } catch {
            return .failure(securityFailure(
                title: "Could not mark this agent reviewed",
                error: error,
                recovery: "The agent may have changed. Check it again, then retry."
            ))
        }
    }

    func acknowledgeSecurityFinding(
        agentId: String,
        findingId: String
    ) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let analysis = securityAnalyses[agentId],
              analysis.findings.contains(where: { $0.id == findingId }) else {
            return .failure(securityFailure(
                title: "This warning is no longer current",
                error: ClientError.invalidResponse,
                recovery: "Check this agent again before ignoring a warning."
            ))
        }
        do {
            securityAcknowledgements.acknowledge(
                agentId: agentId,
                contentHash: analysis.contentHash,
                findingId: findingId
            )
            let acknowledgedIds = securityAcknowledgements.findingIds(
                agentId: agentId,
                contentHash: analysis.contentHash
            )
            let response = try await client.markSecurityReviewed(
                agentId: agentId,
                contentHash: analysis.contentHash,
                acknowledgedFindingIds: acknowledgedIds.sorted()
            )
            guard response.reviewed else { throw ClientError.invalidResponse }
            return .success(securityPresentation(analysis, isStale: false))
        } catch {
            return .failure(securityFailure(
                title: "Could not ignore this warning",
                error: error,
                recovery: "The agent may have changed. Check it again, then retry."
            ))
        }
    }

    func redactedSecurityReport() -> String {
        let header = "Agent Server security report\nGenerated \(Date().formatted())\n"
        let entries = securityAnalyses.values.sorted { $0.agentId < $1.agentId }.map { analysis in
            let name = agents.first(where: { $0.id == analysis.agentId })?.name ?? analysis.agentId
            let findings = analysis.findings.map { "- [\($0.severity)] \($0.title)" }.joined(separator: "\n")
            return "\n\(name): \(analysis.risk.consumerLevel.title)\n\(findings.isEmpty ? "- No findings" : findings)"
        }
        return header + entries.joined(separator: "\n") + "\n\nCredential values and file contents are not included."
    }

    private func securityFailure(title: String, error: Error, recovery: String) -> ConsumerFlowFailure {
        ConsumerFlowFailure(
            title: title,
            message: "The local security check did not finish.",
            recovery: recovery,
            technicalDetails: error.localizedDescription,
            didSave: false,
            canRetry: true
        )
    }

    private func securityPresentation(
        _ analysis: SecurityAnalysisPayload,
        reviewedAt: Date? = nil,
        isStale: Bool? = nil
    ) -> SecurityScanPresentation {
        let acknowledged = securityAcknowledgements.findingIds(
            agentId: analysis.agentId,
            contentHash: analysis.contentHash
        )
        return SecurityScanPresentation(
            findings: analysis.findings
                .filter { !acknowledged.contains($0.id) }
                .map(\.presentation),
            reviewedAt: reviewedAt ?? analysis.reviewState?.reviewedDate,
            isStale: isStale ?? analysis.reviewState?.isStale ?? analysis.isStale
        )
    }

    /// Saves connection keys into ~/.agent-server/.env.local. The server reads
    /// it fresh for capability checks (and layers it over .env), so a follow-up
    /// toggle succeeds immediately; the running daemon picks the values up for
    /// agent runs on its next restart, which we trigger here only when nothing
    /// is running. Keeping secrets in .env.local (separate from the general
    /// .env) is a deliberate, temporary choice.
    func saveConnectionKeys(_ values: [String: String]) throws {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/.env.local")
        var pairs = try EnvFileStore.load(from: url)
        for (key, value) in values {
            if let index = pairs.firstIndex(where: { $0.key == key }) {
                pairs[index] = EnvPair(key: key, value: value)
            } else {
                pairs.append(EnvPair(key: key, value: value))
            }
        }
        try EnvFileStore.save(pairs, to: url)

        if activeRuns.isEmpty {
            requestServerRestart()
        }
    }

    func cleanupStaleRuns() {
        Task {
            do {
                let result = try await client.cleanupStaleRuns()
                self.staleRunCount = 0
                if result.cleaned > 0 {
                    print("[StatusMonitor] Cleaned up \(result.cleaned) stale run(s)")
                }
                poll()
            } catch {
                print("[StatusMonitor] Cleanup failed: \(error)")
            }
        }
    }

    func cancelRun(id: String) {
        Task {
            do {
                try await client.cancelRun(id: id)
                poll()
            } catch {
                // Cancel failed silently; next poll will show current state
            }
        }
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
