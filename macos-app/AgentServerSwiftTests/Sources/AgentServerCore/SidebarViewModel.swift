import Foundation

// MARK: - Row model

struct SidebarRow: Equatable, Identifiable {
    enum State: Equatable {
        case idle
        case running
        case needsYou
    }

    let id: String
    let name: String
    let description: String?
    let state: State
    let pendingDecisionCount: Int
}

// MARK: - Sidebar input

struct SidebarAgent: Equatable {
    let id: String
    let slug: String
    let name: String
    let description: String?
}

// MARK: - Sort & state derivation

enum SidebarSort {
    /// Running agents glide to the top. Within each bucket rows are ordered
    /// alphabetically, case-insensitive, locale-aware.
    static func sortedRows(
        agents: [SidebarAgent],
        runningAgentIds: Set<String>,
        pendingDecisions: [Decision]
    ) -> [SidebarRow] {
        let decisionCounts = pendingDecisions.groupedByAgentSlug()

        let rows = agents.map { agent -> SidebarRow in
            let count = decisionCounts[agent.slug] ?? 0
            let isRunning = runningAgentIds.contains(agent.id)
            let state: SidebarRow.State = {
                if isRunning { return .running }
                if count > 0 { return .needsYou }
                return .idle
            }()
            return SidebarRow(
                id: agent.id,
                name: agent.name,
                description: agent.description,
                state: state,
                pendingDecisionCount: count
            )
        }

        return rows.sorted { lhs, rhs in
            let lhsRunning = lhs.state == .running
            let rhsRunning = rhs.state == .running
            if lhsRunning != rhsRunning { return lhsRunning && !rhsRunning }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }
}
