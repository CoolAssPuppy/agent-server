import AgentServerEventKitCore
import Contacts
import EventKit
import Foundation

final class EventKitDependencies {
    let store: EKEventStore
    let contactStore: CNContactStore
    let grantPolicy: NativeServiceGrantPolicy
    let calendarScope: [String: String]?
    let pagination: PaginationPolicy
    let callbackTimeout: TimeInterval
    let authorization: NativeAuthorization
    let isoFormatter: ISO8601DateFormatter

    init(
        store: EKEventStore = EKEventStore(),
        contactStore: CNContactStore = CNContactStore(),
        grantPolicy: NativeServiceGrantPolicy = NativeServiceGrantPolicy(
            environmentValue: ProcessInfo.processInfo.environment["AGENT_SERVER_NATIVE_SERVICE_GRANTS"]
        ),
        calendarScope: [String: String]? = EventKitDependencies.calendarScopeFromEnvironment(),
        pagination: PaginationPolicy = .nativeData,
        callbackTimeout: TimeInterval = 30
    ) {
        self.store = store
        self.contactStore = contactStore
        self.grantPolicy = grantPolicy
        self.calendarScope = calendarScope
        self.pagination = pagination
        self.callbackTimeout = callbackTimeout
        authorization = NativeAuthorization(
            store: store,
            contactStore: contactStore,
            timeout: callbackTimeout
        )
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        isoFormatter = formatter
    }

    func parseDate(_ value: Any?) -> Date? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        if let date = standard.date(from: string) { return date }
        let dateOnly = DateFormatter()
        dateOnly.dateFormat = "yyyy-MM-dd"
        dateOnly.timeZone = .current
        return dateOnly.date(from: string)
    }

    func page<Element>(_ values: [Element], args: [String: Any]) throws -> Page<Element> {
        do {
            return try pagination.page(values, limit: args["limit"] as? Int, cursor: args["cursor"] as? String)
        } catch PaginationError.invalidCursor {
            throw MCPError.invalidParams("cursor is invalid or no longer available")
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
