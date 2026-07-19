import Foundation

enum RunDetailTabKind: String, CaseIterable {
    case activity
    case logs
    case decisions
    case information

    var title: String {
        rawValue.capitalized
    }
}

enum RunDetailTabMoveDirection {
    case previous
    case next
}

enum RunDetailTabNavigation {
    static func move(
        from current: RunDetailTabKind,
        direction: RunDetailTabMoveDirection,
        available: [RunDetailTabKind]
    ) -> RunDetailTabKind {
        guard let currentIndex = available.firstIndex(of: current) else {
            return available.first ?? current
        }

        let candidateIndex = direction == .next ? currentIndex + 1 : currentIndex - 1
        guard available.indices.contains(candidateIndex) else { return current }
        return available[candidateIndex]
    }
}

/// Drives the run detail **Decisions** sub-tab: splits decisions into pending
/// vs. history for a specific run, sorts history most-recent-resolved first.
final class RunDecisionsViewModel {
    let pending: [Decision]
    let history: [Decision]

    init(runId: String, decisions: [Decision]) {
        let forRun = decisions.filter { $0.taskRunId == runId }
        self.pending = forRun.filter { $0.isPending }
        self.history = forRun
            .filter { $0.status != .pending }
            .sorted { lhs, rhs in
                let l = lhs.resolvedAt ?? lhs.createdAt
                let r = rhs.resolvedAt ?? rhs.createdAt
                return l > r
            }
    }

    var isEmpty: Bool {
        pending.isEmpty && history.isEmpty
    }
}
