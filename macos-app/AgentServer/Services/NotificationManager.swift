import Foundation
import UserNotifications

@MainActor
final class NotificationManager {
    private let center = UNUserNotificationCenter.current()
    private var isAuthorized = false

    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            Task { @MainActor [weak self] in
                self?.isAuthorized = granted
            }
        }
    }

    func notifyRunStarted(agentName: String) {
        post(
            title: agentName,
            body: "Run started",
            identifier: "run-started-\(UUID().uuidString)"
        )
    }

    func notifyRunCompleted(agentName: String, summary: String?) {
        let body = summary.flatMap { trimmed($0) } ?? "Run completed"
        post(
            title: agentName,
            body: body,
            identifier: "run-completed-\(UUID().uuidString)"
        )
    }

    func notifyRunFailed(agentName: String, error: String?) {
        let body = error.flatMap { trimmed($0) } ?? "Run failed"
        post(
            title: "\(agentName) failed",
            body: body,
            identifier: "run-failed-\(UUID().uuidString)"
        )
    }

    private func post(title: String, body: String, identifier: String) {
        guard isAuthorized else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { _ in }
    }

    private func trimmed(_ text: String) -> String? {
        let stripped = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.isEmpty { return nil }

        let maxLength = 240
        if stripped.count <= maxLength { return stripped }

        let endIndex = stripped.index(stripped.startIndex, offsetBy: maxLength)
        return String(stripped[..<endIndex]) + "..."
    }
}
