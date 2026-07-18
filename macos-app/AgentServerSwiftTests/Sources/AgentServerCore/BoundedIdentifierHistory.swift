import Foundation

/// A fixed-size insertion-ordered set for identifiers already presented to a user.
/// Duplicate inserts do not change order, while new entries evict the oldest.
struct BoundedIdentifierHistory {
    private let limit: Int
    private var identifiers: Set<String> = []
    private var insertionOrder: [String] = []

    init(limit: Int) {
        self.limit = max(1, limit)
    }

    var count: Int { identifiers.count }

    func contains(_ identifier: String) -> Bool {
        identifiers.contains(identifier)
    }

    @discardableResult
    mutating func insert(_ identifier: String) -> Bool {
        guard identifiers.insert(identifier).inserted else { return false }
        insertionOrder.append(identifier)
        if insertionOrder.count > limit {
            identifiers.remove(insertionOrder.removeFirst())
        }
        return true
    }
}
