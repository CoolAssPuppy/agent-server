import EventKit
import Foundation

@MainActor
final class EventKitPermissionManager {
    private let store = EKEventStore()

    func requestAccessIfNeeded() {
        requestEventAccess()
        requestReminderAccess()
    }

    static func availableCalendars() -> [GuidanceCalendarResource] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return [] }
        return EKEventStore().calendars(for: .event)
            .map { calendar in
                GuidanceCalendarResource(
                    id: calendar.calendarIdentifier,
                    name: calendar.title,
                    account: calendar.source.title,
                    canModify: calendar.allowsContentModifications
                )
            }
            .sorted {
                let accountOrder = $0.account.localizedStandardCompare($1.account)
                return accountOrder == .orderedSame
                    ? $0.name.localizedStandardCompare($1.name) == .orderedAscending
                    : accountOrder == .orderedAscending
            }
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
