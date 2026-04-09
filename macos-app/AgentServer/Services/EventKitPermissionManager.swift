import EventKit
import Foundation

@MainActor
final class EventKitPermissionManager {
    private let store = EKEventStore()

    func requestAccessIfNeeded() {
        requestEventAccess()
        requestReminderAccess()
    }

    private func requestEventAccess() {
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .notDetermined else { return }
        store.requestFullAccessToEvents { _, _ in }
    }

    private func requestReminderAccess() {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        guard status == .notDetermined else { return }
        store.requestFullAccessToReminders { _, _ in }
    }
}
