import Foundation

/// Computes per-agent pending-decision badge counts for `AgentsListView`.
final class AgentsListBadgeViewModel {
    private let counts: [String: Int]

    init(decisions: [Decision]) {
        self.counts = decisions.groupedByAgentSlug()
    }

    /// Returns the badge count for an agent slug, or `nil` if the agent has no
    /// pending decisions (in which case no badge should be rendered).
    func badge(forAgentSlug slug: String) -> Int? {
        guard let count = counts[slug], count > 0 else { return nil }
        return count
    }

    var totalPending: Int {
        counts.values.reduce(0, +)
    }
}
