import Combine
import Foundation

@MainActor
final class StatusMonitor: ObservableObject {
    @Published private(set) var agents: [Agent] = []
    @Published private(set) var activeRuns: [Run] = []
    @Published private(set) var isServerReachable = false
    @Published private(set) var staleRunCount: Int = 0
    @Published var deepLinkAgentId: String?

    private let client = AgentServerClient()
    private var timer: Timer?
    private let pollInterval: TimeInterval = 5
    private var webSocketTask: URLSessionWebSocketTask?
    private var isWebSocketConnected = false

    private weak var serverProcess: ServerProcessManager?
    private var consecutiveFailures = 0
    private static let restartThreshold = 3
    private var previousServerStartedAt: String?
    private var previousActiveRunIds: Set<String> = []

    func setServerProcess(_ manager: ServerProcessManager) {
        self.serverProcess = manager
    }

    func start() {
        poll()
        connectWebSocket()
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.poll()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        disconnectWebSocket()
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

            if event.type == "run_started" || event.type == "run_completed" || event.type == "run_failed" {
                poll()
            }
        case .data:
            break
        @unknown default:
            break
        }
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
