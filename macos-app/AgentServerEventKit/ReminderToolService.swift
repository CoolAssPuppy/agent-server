import AgentServerEventKitCore
import EventKit
import Foundation

final class ReminderToolService: NativeToolService {
    let names: Set<String> = ["list_reminder_lists", "list_reminders", "create_reminder", "complete_reminder"]
    private let dependencies: EventKitDependencies

    init(dependencies: EventKitDependencies) { self.dependencies = dependencies }

    func call(name: String, arguments: [String: Any]) throws -> String {
        switch name {
        case "list_reminder_lists": return try listReminderLists()
        case "list_reminders": return try listReminders(args: arguments)
        case "create_reminder": return try createReminder(args: arguments)
        case "complete_reminder": return try completeReminder(args: arguments)
        default: throw NativeToolDispatchError.methodNotFound(name)
        }
    }

    // MARK: - Reminders

    private func listReminderLists() throws -> String {
        try dependencies.authorization.ensureReminderAccess()

        let lists = allowedReminderLists(action: "read").map { calendar -> [String: Any] in
            [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "source": calendar.source?.title ?? ""
            ]
        }

        return try dependencies.jsonString(["lists": lists])
    }

    private func listReminders(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureReminderAccess()

        var calendars: [EKCalendar]? = allowedReminderLists(action: "read")
        if let id = args["listId"] as? String, !id.isEmpty {
            calendars = calendars?.filter { $0.calendarIdentifier == id }
            if calendars?.isEmpty == true {
                throw MCPError.invalidParams("That reminder list is not available to this agent")
            }
        } else if let title = args["list"] as? String, !title.isEmpty {
            guard dependencies.grantPolicy.mode == .legacy else {
                throw MCPError.invalidParams("Choose a reminder list by its identifier")
            }
            calendars = calendars?.filter { $0.title == title }
            if calendars?.isEmpty == true {
                throw MCPError.invalidParams("Reminder list not found: \(title)")
            }
        }

        let predicate: NSPredicate
        if let completed = args["completed"] as? Bool {
            if completed {
                predicate = dependencies.store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
            } else {
                predicate = dependencies.store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
            }
        } else {
            predicate = dependencies.store.predicateForReminders(in: calendars)
        }

        let required = try dependencies.requiredItemCount(args: args)
        // EventKit's reminder callback has no limit parameter. Bound its full
        // callback result before constructing response dictionaries.
        let fetched = try dependencies.authorization.fetchReminders(matching: predicate).prefix(required)

        let reminders = fetched.map { reminder -> [String: Any] in
            var item: [String: Any] = [
                "id": reminder.calendarItemIdentifier,
                "title": reminder.title ?? "",
                "notes": reminder.notes ?? "",
                "list": reminder.calendar.title,
                "completed": reminder.isCompleted
            ]
            if let due = reminder.dueDateComponents?.date {
                item["dueDate"] = dependencies.isoFormatter.string(from: due)
            }
            return item
        }

        let page = try dependencies.page(reminders, args: args)
        return try dependencies.jsonString(["reminders": page.items, "pagination": dependencies.paginationObject(page.metadata)])
    }

    private func createReminder(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureReminderAccess()

        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError.invalidParams("title is required")
        }

        let reminder = EKReminder(eventStore: dependencies.store)
        reminder.title = title
        reminder.notes = args["notes"] as? String

        let writableLists = allowedReminderLists(action: "create").filter(\.allowsContentModifications)
        if let listId = args["listId"] as? String, !listId.isEmpty {
            guard let list = writableLists.first(where: { $0.calendarIdentifier == listId }) else {
                throw MCPError.invalidParams("That reminder list cannot be changed by this agent")
            }
            reminder.calendar = list
        } else if let listTitle = args["list"] as? String, !listTitle.isEmpty {
            guard dependencies.grantPolicy.mode == .legacy else {
                throw MCPError.invalidParams("Choose a reminder list by its identifier")
            }
            guard let list = writableLists.first(where: { $0.title == listTitle }) else {
                throw MCPError.invalidParams("Reminder list not found: \(listTitle)")
            }
            reminder.calendar = list
        } else if dependencies.grantPolicy.mode == .scoped {
            guard writableLists.count == 1, let list = writableLists.first else {
                throw MCPError.invalidParams("Choose one reminder list this agent may change")
            }
            reminder.calendar = list
        } else {
            guard let defaultList = dependencies.store.defaultCalendarForNewReminders() else {
                throw MCPError.toolFailed("No default reminder list available")
            }
            reminder.calendar = defaultList
        }

        if let due = dependencies.parseDate(args["dueDate"]) {
            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: due
            )
            reminder.dueDateComponents = components
        }

        do {
            try dependencies.store.save(reminder, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to save reminder: \(error.localizedDescription)")
        }

        return try dependencies.jsonString([
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? ""
        ])
    }

    private func completeReminder(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureReminderAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let item = dependencies.store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw MCPError.toolFailed("Reminder not found: \(id)")
        }
        guard canUseReminderList(item.calendar, action: "complete") else {
            throw MCPError.toolFailed("Reminder not found: \(id)")
        }

        item.isCompleted = true

        do {
            try dependencies.store.save(item, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to complete reminder: \(error.localizedDescription)")
        }

        return try dependencies.jsonString(["completed": true, "id": id])
    }

    private func allowedReminderLists(action: String) -> [EKCalendar] {
        let lists = dependencies.store.calendars(for: .reminder)
        guard dependencies.grantPolicy.mode == .scoped else { return lists }
        let allowed = Set(dependencies.grantPolicy.availableResourceIds(service: .reminders, action: action))
        return lists.filter { allowed.contains($0.calendarIdentifier) }
    }

    private func canUseReminderList(_ list: EKCalendar, action: String) -> Bool {
        guard dependencies.grantPolicy.mode == .scoped else { return list.allowsContentModifications }
        return dependencies.grantPolicy.allows(service: .reminders, resourceId: list.calendarIdentifier, action: action)
            && list.allowsContentModifications
    }

}
