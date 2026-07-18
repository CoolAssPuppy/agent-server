import EventKit
import Foundation
import Contacts

@MainActor
final class EventKitPermissionManager {
    private let store = EKEventStore()

    func requestAccess(for resource: CreationQuestion.NativeResource) async {
        switch resource {
        case .calendar: await requestEventAccess()
        case .reminders: await requestReminderAccess()
        case .contacts: await requestContactAccess()
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

    static func availableContactGroups() -> [GuidanceContactGroupResource] {
        guard CNContactStore.authorizationStatus(for: .contacts) == .authorized else { return [] }
        let contactStore = CNContactStore()
        guard let containers = try? contactStore.containers(matching: nil) else { return [] }
        return containers.flatMap { container in
            let predicate = CNGroup.predicateForGroupsInContainer(withIdentifier: container.identifier)
            let groups = (try? contactStore.groups(matching: predicate)) ?? []
            return groups.map {
                GuidanceContactGroupResource(id: $0.identifier, name: $0.name, account: container.name)
            }
        }.sorted {
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

    private func requestContactAccess() async {
        guard CNContactStore.authorizationStatus(for: .contacts) == .notDetermined else { return }
        _ = try? await CNContactStore().requestAccess(for: .contacts)
    }
}
