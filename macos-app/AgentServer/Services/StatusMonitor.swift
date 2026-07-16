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
    @Published private(set) var staleRunCount: Int = 0
    @Published private(set) var pendingDecisions: [Decision] = []

    private let client = AgentServerClient()
    // Retained only for resolving decisions (a write, POSTed to the panel with
    // the API key). Reading pending decisions now comes from the local daemon,
    // which subscribes to Supabase Realtime and serves them over /decisions —
    // no panel polling, so zero Vercel cost.
    private var panelClient: PanelClient?
    private var timer: Timer?
    private let pollInterval: TimeInterval = 5
    private var webSocketTask: URLSessionWebSocketTask?
    private var isWebSocketConnected = false

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

    func setServerProcess(_ manager: ServerProcessManager) {
        self.serverProcess = manager
    }

    func setNotificationManager(_ manager: NotificationManager) {
        self.notificationManager = manager
    }

    func start() {
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
        Task {
            do {
                let health = try await client.health()
                let fetchedAgents = try await client.agents()
                let fetchedRuns = try await client.runs()

                self.isServerReachable = true
                self.consecutiveFailures = 0
                self.agents = fetchedAgents

                let currentActiveRuns = fetchedRuns.filter { $0.isActive }

                if let serverStartedAt = health.startedAt {
                    if let previous = self.previousServerStartedAt,
                       previous != serverStartedAt {
                        if !self.previousActiveRunIds.isEmpty {
                            self.staleRunCount = self.previousActiveRunIds.count
                        }
                        self.notificationManager?.notifyServerRestarted()
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
                self.isServerReachable = false
                self.activeRuns = []
                self.consecutiveFailures += 1

                if self.consecutiveFailures == Self.restartThreshold {
                    self.autoRestartServer()
                }
            }
        }
    }

    private func autoRestartServer() {
        guard let serverProcess else { return }
        print("[StatusMonitor] Server unreachable after \(Self.restartThreshold) checks, restarting...")
        Task {
            await serverProcess.startIfNeeded()
        }
    }

    func requestServerRestart() {
        guard let serverProcess else { return }
        Task {
            await serverProcess.restart()
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

    /// Saves connection keys into ~/.agent-server/.env. The server reads the
    /// file fresh for capability checks, so a follow-up toggle succeeds
    /// immediately; the running daemon picks the values up for agent runs on
    /// its next restart, which we trigger here only when nothing is running.
    func saveConnectionKeys(_ values: [String: String]) throws {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/.env")
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
        guard let url = LocalServerEndpoint.webSocketURL(port: 47821) else { return }
        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
        isWebSocketConnected = true
        receiveWebSocketMessage()
    }

    private func disconnectWebSocket() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isWebSocketConnected = false
    }

    private func receiveWebSocketMessage() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self else { return }

                switch result {
                case .success(let message):
                    self.handleWebSocketMessage(message)
                    self.receiveWebSocketMessage()
                case .failure:
                    self.isWebSocketConnected = false
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
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await MainActor.run {
                if self.isServerReachable && !self.isWebSocketConnected {
                    self.connectWebSocket()
                }
            }
        }
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
