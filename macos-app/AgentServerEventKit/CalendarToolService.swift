import AgentServerEventKitCore
import EventKit
import Foundation

final class CalendarToolService: NativeToolService {
    let names: Set<String> = ["list_calendars", "list_events", "create_event", "update_event", "delete_event"]
    private let dependencies: EventKitDependencies

    init(dependencies: EventKitDependencies) { self.dependencies = dependencies }

    func call(name: String, arguments: [String: Any]) throws -> String {
        switch name {
        case "list_calendars": return try listCalendars()
        case "list_events": return try listEvents(args: arguments)
        case "create_event": return try createEvent(args: arguments)
        case "update_event": return try updateEvent(args: arguments)
        case "delete_event": return try deleteEvent(args: arguments)
        default: throw NativeToolDispatchError.methodNotFound(name)
        }
    }

    // MARK: - Calendars

    private func listCalendars() throws -> String {
        try dependencies.authorization.ensureEventAccess()

        let calendars = allowedEventCalendars().map { calendar -> [String: Any] in
            [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "source": calendar.source?.title ?? "",
                "allowsModification": canUseCalendar(calendar, action: "create")
                    || canUseCalendar(calendar, action: "update")
            ]
        }

        return try dependencies.jsonString(["calendars": calendars])
    }

    private func listEvents(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureEventAccess()

        guard let start = dependencies.parseDate(args["start"]) else {
            throw MCPError.invalidParams("start must be an ISO 8601 date/time string")
        }
        guard let end = dependencies.parseDate(args["end"]) else {
            throw MCPError.invalidParams("end must be an ISO 8601 date/time string")
        }

        var calendars: [EKCalendar]? = allowedEventCalendars(action: "read")
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

        let predicate = dependencies.store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = try dependencies.events(matching: predicate, args: args).map { event -> [String: Any] in
            [
                "id": event.eventIdentifier ?? "",
                "title": event.title ?? "",
                "start": dependencies.isoFormatter.string(from: event.startDate),
                "end": dependencies.isoFormatter.string(from: event.endDate),
                "location": event.location ?? "",
                "notes": event.notes ?? "",
                "calendar": event.calendar.title,
                "isAllDay": event.isAllDay
            ]
        }

        let page = try dependencies.page(events, args: args)
        return try dependencies.jsonString(["events": page.items, "pagination": dependencies.paginationObject(page.metadata)])
    }

    private func createEvent(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureEventAccess()

        guard let title = args["title"] as? String, !title.isEmpty else {
            throw MCPError.invalidParams("title is required")
        }
        guard let start = dependencies.parseDate(args["start"]) else {
            throw MCPError.invalidParams("start must be an ISO 8601 date/time string")
        }
        guard let end = dependencies.parseDate(args["end"]) else {
            throw MCPError.invalidParams("end must be an ISO 8601 date/time string")
        }

        let event = EKEvent(eventStore: dependencies.store)
        event.title = title
        event.startDate = start
        event.endDate = end
        event.location = args["location"] as? String
        event.notes = args["notes"] as? String
        event.isAllDay = (args["isAllDay"] as? Bool) ?? false

        let writableCalendars = allowedEventCalendars(action: "create")
            .filter(\.allowsContentModifications)
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
        } else if dependencies.grantPolicy.mode == .scoped || dependencies.calendarScope != nil {
            guard writableCalendars.count == 1, let calendar = writableCalendars.first else {
                throw MCPError.invalidParams("Choose one calendar this agent may change")
            }
            event.calendar = calendar
        } else {
            guard let defaultCalendar = dependencies.store.defaultCalendarForNewEvents else {
                throw MCPError.toolFailed("No default calendar available")
            }
            event.calendar = defaultCalendar
        }

        do {
            try dependencies.store.save(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to save event: \(error.localizedDescription)")
        }

        return try dependencies.jsonString([
            "id": event.eventIdentifier ?? "",
            "title": event.title ?? "",
            "start": dependencies.isoFormatter.string(from: event.startDate),
            "end": dependencies.isoFormatter.string(from: event.endDate)
        ])
    }

    private func updateEvent(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureEventAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let event = dependencies.store.event(withIdentifier: id) else {
            throw MCPError.toolFailed("Event not found: \(id)")
        }
        guard canUseCalendar(event.calendar, action: "update") else {
            throw MCPError.toolFailed("This agent can only view that calendar")
        }

        if let title = args["title"] as? String { event.title = title }
        if let location = args["location"] as? String { event.location = location }
        if let notes = args["notes"] as? String { event.notes = notes }
        if let allDay = args["isAllDay"] as? Bool { event.isAllDay = allDay }
        if let start = dependencies.parseDate(args["start"]) { event.startDate = start }
        if let end = dependencies.parseDate(args["end"]) { event.endDate = end }

        do {
            try dependencies.store.save(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to update event: \(error.localizedDescription)")
        }

        return try dependencies.jsonString([
            "id": event.eventIdentifier ?? "",
            "title": event.title ?? "",
            "start": dependencies.isoFormatter.string(from: event.startDate),
            "end": dependencies.isoFormatter.string(from: event.endDate)
        ])
    }

    private func deleteEvent(args: [String: Any]) throws -> String {
        try dependencies.authorization.ensureEventAccess()

        guard let id = args["id"] as? String, !id.isEmpty else {
            throw MCPError.invalidParams("id is required")
        }
        guard let event = dependencies.store.event(withIdentifier: id) else {
            throw MCPError.toolFailed("Event not found: \(id)")
        }
        if dependencies.grantPolicy.mode == .scoped || dependencies.calendarScope != nil {
            throw MCPError.toolFailed("Deleting calendar events was not approved for this agent")
        }

        do {
            try dependencies.store.remove(event, span: .thisEvent, commit: true)
        } catch {
            throw MCPError.toolFailed("Failed to delete event: \(error.localizedDescription)")
        }

        return try dependencies.jsonString(["deleted": true, "id": id])
    }

    private func allowedEventCalendars(action: String = "read") -> [EKCalendar] {
        let calendars = dependencies.store.calendars(for: .event)
        if dependencies.grantPolicy.mode == .scoped {
            let allowed = Set(dependencies.grantPolicy.availableResourceIds(service: .calendar, action: action))
            return calendars.filter { allowed.contains($0.calendarIdentifier) }
        }
        guard let calendarScope = dependencies.calendarScope else { return calendars }
        return calendars.filter { calendarScope[$0.calendarIdentifier] != nil }
    }

    private func canUseCalendar(_ calendar: EKCalendar, action: String) -> Bool {
        if dependencies.grantPolicy.mode == .scoped {
            return dependencies.grantPolicy.allows(service: .calendar, resourceId: calendar.calendarIdentifier, action: action)
                && calendar.allowsContentModifications
        }
        guard let calendarScope = dependencies.calendarScope else { return calendar.allowsContentModifications }
        return calendarScope[calendar.calendarIdentifier] == "read_write"
            && calendar.allowsContentModifications
    }

}
