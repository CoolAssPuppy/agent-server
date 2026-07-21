import Foundation

public enum PaginationError: Error, Equatable {
    case invalidCursor
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

        let limit = min(max(requestedLimit ?? defaultLimit, 1), maximumLimit)
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

    private func decode(_ cursor: String?) throws -> Int {
        guard let cursor else { return 0 }
        guard let offset = Int(cursor), offset >= 0 else {
            throw PaginationError.invalidCursor
        }
        return offset
    }
}
