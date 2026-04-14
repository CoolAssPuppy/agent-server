import Combine
import Foundation

@MainActor
final class StatusMonitor: ObservableObject {
    @Published private(set) var agents: [Agent] = []
    @Published private(set) var activeRuns: [Run] = []
    /// Most recent completed/failed run per agent. Drives the sidebar's
    /// "failed last run" red indicator.
    @Published private(set) var lastRunByAgent: [String: Run] = [:]
    @Published private(set) var isServerReachable = false
    @Published private(set) var staleRunCount: Int = 0
    @Published private(set) var pendingDecisions: [Decision] = []
    @Published var deepLinkAgentId: String?

    private let client = AgentServerClient()
    private var panelClient: PanelClient?
    private var decisionsTimer: Timer?
    private let decisionsPollInterval: TimeInterval = 10
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
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.poll()
            }
        }
        decisionsTimer = Timer.scheduledTimer(withTimeInterval: decisionsPollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.pollDecisions()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        decisionsTimer?.invalidate()
        decisionsTimer = nil
        disconnectWebSocket()
    }

    // MARK: - Decisions polling

    func pollDecisions() {
        if panelClient == nil {
            panelClient = PanelClient.fromEnv()
        }
        guard let panelClient else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                let decisions = try await panelClient.fetchPendingDecisions()
                self.pendingDecisions = decisions
            } catch {
                // Silently ignore — keep previous list until next poll succeeds.
            }
        }
    }

    func resolveDecision(id: String, body: DecisionResolveBody) {
        // Optimistic removal.
        pendingDecisions.removeAll { $0.id == id }
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
                       previous != serverStartedAt,
                       !self.previousActiveRunIds.isEmpty {
                        self.staleRunCount = self.previousActiveRunIds.count
                    }
                    self.previousServerStartedAt = serverStartedAt
                }

                self.previousActiveRunIds = Set(currentActiveRuns.map { $0.runId })
                self.activeRuns = currentActiveRuns

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
                self.agents = []
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
        guard let url = URL(string: "ws://localhost:47821/ws") else { return }
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
            case "run_started":
                notificationManager?.notifyRunStarted(agentName: agentName(for: event.agentId))
                poll()
            case "run_completed":
                notificationManager?.notifyRunCompleted(
                    agentName: agentName(for: event.agentId),
                    summary: event.summary
                )
                poll()
            case "run_failed":
                notificationManager?.notifyRunFailed(
                    agentName: agentName(for: event.agentId),
                    error: event.error ?? event.message
                )
                poll()
            default:
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

struct ProgressEvent: Decodable {
    let type: String
    let runId: String
    let agentId: String
    let timestamp: String
    let message: String?
    let error: String?
    let summary: String?
}
