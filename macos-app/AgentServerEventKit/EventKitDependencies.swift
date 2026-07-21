import AgentServerEventKitCore
import Contacts
import EventKit
import Foundation

protocol NativeAuthorizationProviding {
    func ensureEventAccess() throws
    func ensureReminderAccess() throws
    func ensureContactAccess() throws
    func fetchReminders(matching predicate: NSPredicate) throws -> [EKReminder]
}

typealias EventFetcher = (NSPredicate) -> [EKEvent]
typealias ContactFetcher = (NSPredicate, [CNKeyDescriptor], Int) throws -> [CNContact]

final class EventKitDependencies {
    let store: EKEventStore
    let grantPolicy: NativeServiceGrantPolicy
    let calendarScope: [String: String]?
    let pagination: PaginationPolicy
    let authorization: any NativeAuthorizationProviding
    let isoFormatter: ISO8601DateFormatter
    private let fractionalISOFormatter: ISO8601DateFormatter
    private let dateOnlyFormatter: DateFormatter
    private let eventFetcher: EventFetcher
    private let contactFetcher: ContactFetcher

    init(
        store: EKEventStore = EKEventStore(),
        contactStore: CNContactStore = CNContactStore(),
        grantPolicy: NativeServiceGrantPolicy = NativeServiceGrantPolicy(
            environmentValue: ProcessInfo.processInfo.environment["AGENT_SERVER_NATIVE_SERVICE_GRANTS"]
        ),
        calendarScope: [String: String]? = EventKitDependencies.calendarScopeFromEnvironment(),
        pagination: PaginationPolicy = .nativeData,
        callbackTimeout: TimeInterval = 30,
        authorization: (any NativeAuthorizationProviding)? = nil,
        eventFetcher: EventFetcher? = nil,
        contactFetcher: ContactFetcher? = nil
    ) {
        self.store = store
        self.grantPolicy = grantPolicy
        self.calendarScope = calendarScope
        self.pagination = pagination
        self.authorization = authorization ?? NativeAuthorization(
            store: store, contactStore: contactStore, timeout: callbackTimeout
        )
        self.eventFetcher = eventFetcher ?? { store.events(matching: $0) }
        self.contactFetcher = contactFetcher ?? { predicate, keys, maximumCount in
            var contacts: [CNContact] = []
            let request = CNContactFetchRequest(keysToFetch: keys)
            request.predicate = predicate
            request.unifyResults = false
            try contactStore.enumerateContacts(with: request) { contact, stop in
                contacts.append(contact)
                if contacts.count >= maximumCount { stop.pointee = true }
            }
            return contacts
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        isoFormatter = formatter
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        fractionalISOFormatter = fractionalFormatter
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"
        dayFormatter.timeZone = .current
        dateOnlyFormatter = dayFormatter
    }

    func parseDate(_ value: Any?) -> Date? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return fractionalISOFormatter.date(from: string)
            ?? isoFormatter.date(from: string)
            ?? dateOnlyFormatter.date(from: string)
    }

    func events(matching predicate: NSPredicate, args: [String: Any]) throws -> [EKEvent] {
        let required = try requiredItemCount(args: args)
        // EventKit has no bounded event query. Keep only the requested page
        // plus one lookahead item as soon as its materialized array returns.
        return Array(eventFetcher(predicate).prefix(required))
    }

    func contacts(
        matching predicate: NSPredicate,
        keys: [CNKeyDescriptor],
        args: [String: Any]
    ) throws -> [CNContact] {
        try contactFetcher(predicate, keys, requiredItemCount(args: args))
    }

    func requiredItemCount(args: [String: Any]) throws -> Int {
        try translatingPaginationErrors {
            try pagination.requiredItemCount(arguments: args)
        }
    }

    func page<Element>(_ values: [Element], args: [String: Any]) throws -> Page<Element> {
        try translatingPaginationErrors {
            try pagination.page(values, arguments: args)
        }
    }

    private func translatingPaginationErrors<Value>(
        _ operation: () throws -> Value
    ) throws -> Value {
        do {
            return try operation()
        } catch PaginationError.invalidCursor {
            throw MCPError.invalidParams("cursor is invalid or no longer available")
        } catch PaginationError.invalidLimit {
            throw MCPError.invalidParams("limit must be greater than zero")
        } catch PaginationError.invalidLimitType {
            throw MCPError.invalidParams("limit must be an integer")
        } catch PaginationError.invalidCursorType {
            throw MCPError.invalidParams("cursor must be a string")
        }
    }

    func paginationObject(_ metadata: PaginationMetadata) -> [String: Any] {
        var value: [String: Any] = ["limit": metadata.limit, "hasMore": metadata.hasMore]
        if let nextCursor = metadata.nextCursor { value["nextCursor"] = nextCursor }
        return value
    }

    func jsonString(_ object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func calendarScopeFromEnvironment() -> [String: String]? {
        guard let raw = ProcessInfo.processInfo.environment["AGENT_SERVER_CALENDAR_SCOPE"],
              let data = raw.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] else {
            return nil
        }
        return values.reduce(into: [:]) { result, value in
            guard let id = value["id"], let access = value["access"] else { return }
            result[id] = access
        }
    }
}
