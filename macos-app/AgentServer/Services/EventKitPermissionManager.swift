import EventKit
import Foundation

@MainActor
final class EventKitPermissionManager {
    private let store = EKEventStore()

    func requestAccessNeeded(for request: String) async {
        let intent = request.lowercased()
        if intent.range(of: #"\b(calendar|calendars|events|appointments)\b"#, options: .regularExpression) != nil {
            await requestEventAccess()
        }
        if intent.range(of: #"\b(reminders?|to-?dos?|tasks?)\b"#, options: .regularExpression) != nil {
            await requestReminderAccess()
        }
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

    static func availableReminderLists() -> [GuidanceReminderListResource] {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { return [] }
        return EKEventStore().calendars(for: .reminder)
            .map { list in
                GuidanceReminderListResource(
                    id: list.calendarIdentifier,
                    name: list.title,
                    account: list.source.title,
                    canModify: list.allowsContentModifications
                )
            }
            .sorted {
                let accountOrder = $0.account.localizedStandardCompare($1.account)
                return accountOrder == .orderedSame
                    ? $0.name.localizedStandardCompare($1.name) == .orderedAscending
                    : accountOrder == .orderedAscending
            }
    }

    private func requestEventAccess() async {
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .notDetermined else { return }
        _ = try? await store.requestFullAccessToEvents()
    }

    private func requestReminderAccess() async {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        guard status == .notDetermined else { return }
        _ = try? await store.requestFullAccessToReminders()
    }
}
