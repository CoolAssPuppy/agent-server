import Foundation

// MARK: - Row model

struct SidebarRow: Equatable, Identifiable {
    enum State: Equatable {
        case idle
        case running
        case needsYou
        case failed
    }

    /// Trigger type that determines which SF Symbol to render for the row.
    /// Mirrors AgentModel.AgentKind but lives in AgentServerCore so this
    /// model stays framework-free.
    enum Kind: Equatable {
        case scheduled
        case interactive
        case watcher
        case chained
        case onDemand

        public var iconName: String {
            switch self {
            case .scheduled: return "clock"
            case .interactive: return "bubble.left.and.bubble.right"
            case .watcher: return "eye"
            case .chained: return "link"
            case .onDemand: return "play.circle"
            }
        }
    }

    let id: String
    let name: String
    let description: String?
    let kind: Kind
    let state: State
    let pendingDecisionCount: Int
}

// MARK: - Sidebar input

struct SidebarAgent: Equatable {
    let id: String
    let slug: String
    let name: String
    let description: String?
    let kind: SidebarRow.Kind
    let lastRunFailed: Bool
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
                if agent.lastRunFailed { return .failed }
                return .idle
            }()
            return SidebarRow(
                id: agent.id,
                name: agent.name,
                description: agent.description,
                kind: agent.kind,
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
