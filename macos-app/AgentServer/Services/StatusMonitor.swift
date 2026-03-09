import Combine
import Foundation

@MainActor
final class StatusMonitor: ObservableObject {
    @Published private(set) var agents: [Agent] = []
    @Published private(set) var activeRuns: [Run] = []
    @Published private(set) var isServerReachable = false

    private let client = AgentServerClient()
    private var timer: Timer?
    private let pollInterval: TimeInterval = 5

    func start() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.poll()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func poll() {
        Task {
            do {
                let _ = try await client.health()
                let fetchedAgents = try await client.agents()
                let fetchedRuns = try await client.runs()

                self.isServerReachable = true
                self.agents = fetchedAgents
                self.activeRuns = fetchedRuns.filter { $0.isActive }
            } catch {
                self.isServerReachable = false
                self.agents = []
                self.activeRuns = []
            }
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
}
