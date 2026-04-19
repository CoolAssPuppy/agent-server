import Foundation
import UserNotifications

@MainActor
final class NotificationManager {
    private let center = UNUserNotificationCenter.current()
    private var isAuthorized = false
    let preferences: NotificationPreferences

    init(preferences: NotificationPreferences = NotificationPreferences()) {
        self.preferences = preferences
    }

    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            Task { @MainActor [weak self] in
                self?.isAuthorized = granted
            }
        }
    }

    // MARK: Agent output (tier 2)

    func notifyRunCompleted(agentName: String, summary: String?) {
        let body = summary.flatMap { trimmed($0) } ?? "Run completed"
        post(
            title: agentName,
            body: body,
            category: .agentOutput,
            identifier: "run-completed-\(UUID().uuidString)"
        )
    }

    func notifyRunFailed(agentName: String, error: String?) {
        let body = error.flatMap { trimmed($0) } ?? "Run failed"
        post(
            title: "\(agentName) failed",
            body: body,
            category: .agentOutput,
            identifier: "run-failed-\(UUID().uuidString)"
        )
    }

    // MARK: System events (tier 1)

    func notifyRunTimedOut(agentName: String) {
        post(
            title: "\(agentName) timed out",
            body: "The run exceeded its wall-clock timeout and was aborted.",
            category: .systemEvent,
            identifier: "run-timeout-\(UUID().uuidString)"
        )
    }

    func notifyMcpNeedsAuth(serverNames: [String]) {
        guard !serverNames.isEmpty else { return }
        let list = serverNames.joined(separator: ", ")
        post(
            title: "Reconnect required",
            body: "These MCP servers need re-auth in Claude Code: \(list)",
            category: .systemEvent,
            identifier: "mcp-auth-\(UUID().uuidString)"
        )
    }

    func notifyServerRestarted() {
        post(
            title: "Agent Server restarted",
            body: "Previously running agents were released.",
            category: .systemEvent,
            identifier: "server-restart-\(UUID().uuidString)"
        )
    }

    // MARK: Internal

    private func post(
        title: String,
        body: String,
        category: NotificationCategory,
        identifier: String
    ) {
        guard isAuthorized else { return }
        guard preferences.shouldPost(category) else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = Self.customSound

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { _ in }
    }

    /// Custom chime bundled at `Contents/Resources/agent-server-notification.caf`.
    /// Falls back to `.default` if macOS can't locate it (e.g. during tests).
    private static let customSound: UNNotificationSound = {
        let name = UNNotificationSoundName("agent-server-notification.caf")
        return UNNotificationSound(named: name)
    }()

    private func trimmed(_ text: String) -> String? {
        let stripped = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.isEmpty { return nil }

        let maxLength = 240
        if stripped.count <= maxLength { return stripped }

        let endIndex = stripped.index(stripped.startIndex, offsetBy: maxLength)
        return String(stripped[..<endIndex]) + "..."
    }
}
