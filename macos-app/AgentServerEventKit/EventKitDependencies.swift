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
    let authorization: NativeAuthorization
    let isoFormatter: ISO8601DateFormatter
    private let fractionalISOFormatter: ISO8601DateFormatter
    private let dateOnlyFormatter: DateFormatter

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
        authorization = NativeAuthorization(
            store: store,
            contactStore: contactStore,
            timeout: callbackTimeout
        )
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

    func page<Element>(_ values: [Element], args: [String: Any]) throws -> Page<Element> {
        do {
            return try pagination.page(values, arguments: args)
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
