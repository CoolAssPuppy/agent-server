import Foundation

public enum PaginationError: Error, Equatable {
    case invalidCursor
    case invalidLimit
    case invalidCursorType
    case invalidLimitType
}

public struct PaginationMetadata: Equatable, Sendable {
    public let limit: Int
    public let hasMore: Bool
    public let nextCursor: String?
}

public struct Page<Element> {
    public let items: [Element]
    public let metadata: PaginationMetadata
}

public struct PaginationPolicy: Sendable {
    public static let nativeData = PaginationPolicy(defaultLimit: 50, maximumLimit: 200)

    public let defaultLimit: Int
    public let maximumLimit: Int

    public init(defaultLimit: Int, maximumLimit: Int) {
        precondition(defaultLimit > 0)
        precondition(maximumLimit >= defaultLimit)
        self.defaultLimit = defaultLimit
        self.maximumLimit = maximumLimit
    }

    public func page<Element>(
        _ values: [Element],
        limit requestedLimit: Int?,
        cursor: String?
    ) throws -> Page<Element> {
        let offset = try decode(cursor)
        guard offset <= values.count else { throw PaginationError.invalidCursor }

        if let requestedLimit, requestedLimit < 1 { throw PaginationError.invalidLimit }
        let limit = min(requestedLimit ?? defaultLimit, maximumLimit)
        let end = min(offset + limit, values.count)
        let hasMore = end < values.count
        return Page(
            items: Array(values[offset..<end]),
            metadata: PaginationMetadata(
                limit: limit,
                hasMore: hasMore,
                nextCursor: hasMore ? String(end) : nil
            )
        )
    }

    public func page<Element>(_ values: [Element], arguments: [String: Any]) throws -> Page<Element> {
        let limit = try typedValue(arguments["limit"], as: Int.self, error: .invalidLimitType)
        let cursor = try typedValue(arguments["cursor"], as: String.self, error: .invalidCursorType)
        return try page(values, limit: limit, cursor: cursor)
    }

    private func decode(_ cursor: String?) throws -> Int {
        guard let cursor else { return 0 }
        guard let offset = Int(cursor), offset >= 0 else {
            throw PaginationError.invalidCursor
        }
        return offset
    }

    private func typedValue<Value>(
        _ value: Any?,
        as type: Value.Type,
        error: PaginationError
    ) throws -> Value? {
        guard let value else { return nil }
        guard let typed = value as? Value else { throw error }
        return typed
    }
}
