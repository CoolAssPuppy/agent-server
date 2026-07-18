import EventKit
import Foundation

final class EventKitHandler: MCPHandler {
    private let store = EKEventStore()
    private let calendarScope: [String: String]? = {
        guard let raw = ProcessInfo.processInfo.environment["AGENT_SERVER_CALENDAR_SCOPE"],
              let data = raw.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] else {
            return nil
        }
        return values.reduce(into: [String: String]()) { result, value in
            guard let id = value["id"], let access = value["access"] else { return }
            result[id] = access
        }
    }()
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    func tools() -> [MCPTool] {
        var result: [MCPTool] = []

        let emptyProps: [String: Any] = [String: Any]()
        let stringProp: [String: Any] = ["type": "string"]
        let boolProp: [String: Any] = ["type": "boolean"]

        var listCalendarsSchema: [String: Any] = [:]
        listCalendarsSchema["type"] = "object"
        listCalendarsSchema["properties"] = emptyProps
        result.append(MCPTool(
            name: "list_calendars",
            description: "List all available calendars with their titles and identifiers.",
            inputSchema: listCalendarsSchema
        ))

        var listEventsProps: [String: Any] = [:]
        listEventsProps["start"] = ["type": "string", "description": "ISO 8601 start date/time"]
        listEventsProps["end"] = ["type": "string", "description": "ISO 8601 end date/time"]
        listEventsProps["calendar"] = ["type": "string", "description": "Optional calendar title to filter by"]
        listEventsProps["calendarId"] = ["type": "string", "description": "Selected calendar identifier"]
        var listEventsSchema: [String: Any] = [:]
        listEventsSchema["type"] = "object"
        listEventsSchema["properties"] = listEventsProps
        listEventsSchema["required"] = ["start", "end"]
        result.append(MCPTool(
            name: "list_events",
            description: "List calendar events within a date range. Dates must be ISO 8601 (e.g. 2026-04-09T00:00:00Z).",
            inputSchema: listEventsSchema
        ))

        var createEventProps: [String: Any] = [:]
        createEventProps["title"] = stringProp
        createEventProps["start"] = ["type": "string", "description": "ISO 8601 start date/time"]
        createEventProps["end"] = ["type": "string", "description": "ISO 8601 end date/time"]
        createEventProps["calendar"] = ["type": "string", "description": "Optional calendar title. Defaults to the default calendar."]
        createEventProps["calendarId"] = ["type": "string", "description": "Selected writable calendar identifier"]
        createEventProps["location"] = stringProp
        createEventProps["notes"] = stringProp
        createEventProps["isAllDay"] = boolProp
        var createEventSchema: [String: Any] = [:]
        createEventSchema["type"] = "object"
        createEventSchema["properties"] = createEventProps
        createEventSchema["required"] = ["title", "start", "end"]
        result.append(MCPTool(
            name: "create_event",
            description: "Create a new calendar event. Returns the event id.",
            inputSchema: createEventSchema
        ))

        var updateEventProps: [String: Any] = [:]
        updateEventProps["id"] = stringProp
        updateEventProps["title"] = stringProp
        updateEventProps["start"] = stringProp
        updateEventProps["end"] = stringProp
        updateEventProps["location"] = stringProp
        updateEventProps["notes"] = stringProp
        updateEventProps["isAllDay"] = boolProp
        var updateEventSchema: [String: Any] = [:]
        updateEventSchema["type"] = "object"
        updateEventSchema["properties"] = updateEventProps
        updateEventSchema["required"] = ["id"]
        result.append(MCPTool(
            name: "update_event",
            description: "Update an existing calendar event by id. Only provided fields are changed.",
            inputSchema: updateEventSchema
        ))

        var deleteEventProps: [String: Any] = [:]
        deleteEventProps["id"] = stringProp
        var deleteEventSchema: [String: Any] = [:]
        deleteEventSchema["type"] = "object"
        deleteEventSchema["properties"] = deleteEventProps
        deleteEventSchema["required"] = ["id"]
        result.append(MCPTool(
            name: "delete_event",
            description: "Delete a calendar event by id.",
            inputSchema: deleteEventSchema
        ))

        var listReminderListsSchema: [String: Any] = [:]
        listReminderListsSchema["type"] = "object"
        listReminderListsSchema["properties"] = emptyProps
        result.append(MCPTool(
            name: "list_reminder_lists",
            description: "List all reminder lists with their titles and identifiers.",
            inputSchema: listReminderListsSchema
        ))

        var listRemindersProps: [String: Any] = [:]
        listRemindersProps["list"] = ["type": "string", "description": "Optional reminder list title"]
        listRemindersProps["completed"] = ["type": "boolean", "description": "Optional filter: true for completed, false for incomplete, omit for all"]
        var listRemindersSchema: [String: Any] = [:]
        listRemindersSchema["type"] = "object"
        listRemindersSchema["properties"] = listRemindersProps
        result.append(MCPTool(
            name: "list_reminders",
            description: "List reminders, optionally filtered by list title and completion state.",
            inputSchema: listRemindersSchema
        ))

        var createReminderProps: [String: Any] = [:]
        createReminderProps["title"] = stringProp
        createReminderProps["dueDate"] = ["type": "string", "description": "Optional ISO 8601 due date/time"]
        createReminderProps["list"] = ["type": "string", "description": "Optional reminder list title. Defaults to the default list."]
        createReminderProps["notes"] = stringProp
        var createReminderSchema: [String: Any] = [:]
        createReminderSchema["type"] = "object"
        createReminderSchema["properties"] = createReminderProps
        createReminderSchema["required"] = ["title"]
        result.append(MCPTool(
            name: "create_reminder",
            description: "Create a new reminder. Returns the reminder id.",
            inputSchema: createReminderSchema
        ))

        var completeReminderProps: [String: Any] = [:]
        completeReminderProps["id"] = stringProp
        var completeReminderSchema: [String: Any] = [:]
        completeReminderSchema["type"] = "object"
        completeReminderSchema["properties"] = completeReminderProps
        completeReminderSchema["required"] = ["id"]
        result.append(MCPTool(
            name: "complete_reminder",
            description: "Mark a reminder as completed by id.",
            inputSchema: completeReminderSchema
        ))

        return result
    }

    func call(name: String, arguments: [String: Any]) throws -> String {
        switch name {
        case "list_calendars": return try listCalendars()
        case "list_events": return try listEvents(args: arguments)
        case "create_event": return try createEvent(args: arguments)
        case "update_event": return try updateEvent(args: arguments)
        case "delete_event": return try deleteEvent(args: arguments)
        case "list_reminder_lists": return try listReminderLists()
        case "list_reminders": return try listReminders(args: arguments)
        case "create_reminder": return try createReminder(args: arguments)
        case "complete_reminder": return try completeReminder(args: arguments)
        default:
            throw MCPError.methodNotFound(name)
        }
    }

    // MARK: - Authorization

    private func ensureEventAccess() throws {
        let status = EKEventStore.authorizationStatus(for: .event)
        switch status {
        case .fullAccess:
            return
        case .denied, .restricted:
            throw MCPError.toolFailed("Calendar access denied. Grant permission in System Settings > Privacy & Security > Calendars.")
        case .writeOnly, .notDetermined:
            try requestAccess(for: .event)
        @unknown default:
            try requestAccess(for: .event)
        }
    }

    private func ensureReminderAccess() throws {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        switch status {
        case .fullAccess:
            return
        case .denied, .restricted:
            throw MCPError.toolFailed("Reminder access denied. Grant permission in System Settings > Privacy & Security > Reminders.")
        case .writeOnly, .notDetermined:
            try requestAccess(for: .reminder)
        @unknown default:
            try requestAccess(for: .reminder)
        }
    }

    private func requestAccess(for entity: EKEntityType) throws {
        let sem = DispatchSemaphore(value: 0)
        var granted = false
        var reqError: Error?

        let completion: (Bool, Error?) -> Void = { g, e in
            granted = g
            reqError = e
            sem.signal()
        }

        switch entity {
        case .event:
            store.requestFullAccessToEvents(completion: completion)
        case .reminder:
            store.requestFullAccessToReminders(completion: completion)
        @unknown default:
            throw MCPError.toolFailed("Unknown entity type")
        }

        sem.wait()

        if let reqError {
            throw MCPError.toolFailed("Access request failed: \(reqError.localizedDescription)")
        }
        if !granted {
            let entityName = entity == .event ? "Calendar" : "Reminder"
            throw MCPError.toolFailed("\(entityName) access not granted.")
        }
    }

    // MARK: - Calendars

    private func listCalendars() throws -> String {
        try ensureEventAccess()

        let calendars = allowedEventCalendars().map { calendar -> [String: Any] in
            [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "source": calendar.source?.title ?? "",
                "allowsModification": calendar.allowsContentModifications
            ]
        }

        return try jsonString(["calendars": calendars])
    }

    private func listEvents(args: [String: Any]) throws -> String {
        try ensureEventAccess()

        guard let start = parseDate(args["start"]) else {
            throw MCPError.invalidParams("start must be an ISO 8601 date/time string")
        }
        guard let end = parseDate(args["end"]) else {
            throw MCPError.invalidParams("end must be an ISO 8601 date/time string")
        }

        var calendars: [EKCalendar]? = allowedEventCalendars()
        if let id = args["calendarId"] as? String, !id.isEmpty {
            calendars = calendars?.filter { $0.calendarIdentifier == id }
            if calendars?.isEmpty == true {
                throw MCPError.invalidParams("That calendar is not available to this agent")
            }
        }
        if let title = args["calendar"] as? String, !title.isEmpty {
            calendars = calendars?.filter { $0.title == title }
            if calendars?.isEmpty == true {
                throw MCPError.invalidParams("Calendar not found: \(title)")
            }
        }

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = store.events(matching: predicate).map { event -> [String: Any] in
            [
                "id": event.eventIdentifier ?? "",
                "title": event.title ?? "",
                "start": isoFormatter.string(from: event.startDate),
                "end": isoFormatter.string(from: event.endDate),
                "location": event.location ?? "",
                "notes": event.notes ?? "",
                "calendar": event.calendar.title,
                "isAllDay": event.isAllDay
            ]
        }

        return try jsonString(["events": events])
    }

    private func createEvent(args: [String: Any]) throws -> String {
        try ensureEventAccess()

        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError.invalidParams("title is required")
        }
        guard let start = parseDate(args["start"]) else {
            throw MCPError.invalidParams("start must be an ISO 8601 date/time string")
        }
        guard let end = parseDate(args["end"]) else {
            throw MCPError.invalidParams("end must be an ISO 8601 date/time string")
        }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end
        event.location = args["location"] as? String
        event.notes = args["notes"] as? String
        event.isAllDay = (args["isAllDay"] as? Bool) ?? false

        let writableCalendars = allowedEventCalendars().filter(canModifyCalendar)
        if let calendarId = args["calendarId"] as? String, !calendarId.isEmpty {
            guard let calendar = writableCalendars.first(where: { $0.calendarIdentifier == calendarId }) else {
                throw MCPError.invalidParams("That calendar cannot be changed by this agent")
            }
            event.calendar = calendar
        } else if let calendarTitle = args["calendar"] as? String, !calendarTitle.isEmpty {
            guard let calendar = writableCalendars.first(where: { $0.title == calendarTitle }) else {
                throw MCPError.invalidParams("Calendar not found: \(calendarTitle)")
            }
            event.calendar = calendar
        } else if calendarScope != nil {
            guard writableCalendars.count == 1, let calendar = writableCalendars.first else {
                throw MCPError.invalidParams("Choose one calendar this agent may change")
            }
            event.calendar = calendar
        } else {
            guard let defaultCalendar = store.defaultCalendarForNewEvents else {
                throw MCPError.toolFailed("No default calendar available")
            }
            event.calendar = defaultCalendar
        }

        do {
            try store.save(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to save event: \(error.localizedDescription)")
        }

        return try jsonString([
            "id": event.eventIdentifier ?? "",
            "title": event.title ?? "",
            "start": isoFormatter.string(from: event.startDate),
            "end": isoFormatter.string(from: event.endDate)
        ])
    }

    private func updateEvent(args: [String: Any]) throws -> String {
        try ensureEventAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let event = store.event(withIdentifier: id) else {
            throw MCPError.toolFailed("Event not found: \(id)")
        }
        guard canModifyCalendar(event.calendar) else {
            throw MCPError.toolFailed("This agent can only view that calendar")
        }

        if let title = args["title"] as? String { event.title = title }
        if let location = args["location"] as? String { event.location = location }
        if let notes = args["notes"] as? String { event.notes = notes }
        if let allDay = args["isAllDay"] as? Bool { event.isAllDay = allDay }
        if let start = parseDate(args["start"]) { event.startDate = start }
        if let end = parseDate(args["end"]) { event.endDate = end }

        do {
            try store.save(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to update event: \(error.localizedDescription)")
        }

        return try jsonString([
            "id": event.eventIdentifier ?? "",
            "title": event.title ?? "",
            "start": isoFormatter.string(from: event.startDate),
            "end": isoFormatter.string(from: event.endDate)
        ])
    }

    private func deleteEvent(args: [String: Any]) throws -> String {
        try ensureEventAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let event = store.event(withIdentifier: id) else {
            throw MCPError.toolFailed("Event not found: \(id)")
        }
        if calendarScope != nil {
            throw MCPError.toolFailed("Deleting calendar events was not approved for this agent")
        }

        do {
            try store.remove(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to delete event: \(error.localizedDescription)")
        }

        return try jsonString(["deleted": true, "id": id])
    }

    // MARK: - Reminders

    private func listReminderLists() throws -> String {
        try ensureReminderAccess()

        let lists = store.calendars(for: .reminder).map { calendar -> [String: Any] in
            [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "source": calendar.source?.title ?? ""
            ]
        }

        return try jsonString(["lists": lists])
    }

    private func listReminders(args: [String: Any]) throws -> String {
        try ensureReminderAccess()

        var calendars: [EKCalendar]?
        if let title = args["list"] as? String, !title.isEmpty {
            calendars = store.calendars(for: .reminder).filter { $0.title == title }
            if calendars?.isEmpty == true {
                throw MCPError.invalidParams("Reminder list not found: \(title)")
            }
        }

        let predicate: NSPredicate
        if let completed = args["completed"] as? Bool {
            if completed {
                predicate = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
            } else {
                predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
            }
        } else {
            predicate = store.predicateForReminders(in: calendars)
        }

        let sem = DispatchSemaphore(value: 0)
        var fetched: [EKReminder] = []
        store.fetchReminders(matching: predicate) { reminders in
            fetched = reminders ?? []
            sem.signal()
        }
        sem.wait()

        let reminders = fetched.map { reminder -> [String: Any] in
            var item: [String: Any] = [
                "id": reminder.calendarItemIdentifier,
                "title": reminder.title ?? "",
                "notes": reminder.notes ?? "",
                "list": reminder.calendar.title,
                "completed": reminder.isCompleted
            ]
            if let due = reminder.dueDateComponents?.date {
                item["dueDate"] = isoFormatter.string(from: due)
            }
            return item
        }

        return try jsonString(["reminders": reminders])
    }

    private func createReminder(args: [String: Any]) throws -> String {
        try ensureReminderAccess()

        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError.invalidParams("title is required")
        }

        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.notes = args["notes"] as? String

        if let listTitle = args["list"] as? String, !listTitle.isEmpty {
            guard let list = store.calendars(for: .reminder).first(where: { $0.title == listTitle }) else {
                throw MCPError.invalidParams("Reminder list not found: \(listTitle)")
            }
            reminder.calendar = list
        } else {
            guard let defaultList = store.defaultCalendarForNewReminders() else {
                throw MCPError.toolFailed("No default reminder list available")
            }
            reminder.calendar = defaultList
        }

        if let due = parseDate(args["dueDate"]) {
            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: due
            )
            reminder.dueDateComponents = components
        }

        do {
            try store.save(reminder, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to save reminder: \(error.localizedDescription)")
        }

        return try jsonString([
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? ""
        ])
    }

    private func completeReminder(args: [String: Any]) throws -> String {
        try ensureReminderAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw MCPError.toolFailed("Reminder not found: \(id)")
        }

        item.isCompleted = true

        do {
            try store.save(item, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to complete reminder: \(error.localizedDescription)")
        }

        return try jsonString(["completed": true, "id": id])
    }

    // MARK: - Helpers

    private func allowedEventCalendars() -> [EKCalendar] {
        let calendars = store.calendars(for: .event)
        guard let calendarScope else { return calendars }
        return calendars.filter { calendarScope[$0.calendarIdentifier] != nil }
    }

    private func canModifyCalendar(_ calendar: EKCalendar) -> Bool {
        guard let calendarScope else { return calendar.allowsContentModifications }
        return calendarScope[calendar.calendarIdentifier] == "read_write"
            && calendar.allowsContentModifications
    }

    private func parseDate(_ value: Any?) -> Date? {
        guard let str = value as? String, !str.isEmpty else { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: str) { return d }

        let withoutFraction = ISO8601DateFormatter()
        withoutFraction.formatOptions = [.withInternetDateTime]
        if let d = withoutFraction.date(from: str) { return d }

        let dateOnly = DateFormatter()
        dateOnly.dateFormat = "yyyy-MM-dd"
        dateOnly.timeZone = TimeZone.current
        if let d = dateOnly.date(from: str) { return d }

        return nil
    }

    private func jsonString(_ obj: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
