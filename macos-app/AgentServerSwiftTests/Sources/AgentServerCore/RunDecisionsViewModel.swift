import Foundation

/// Sub-tab kinds for the run detail tab bar. Chunk 10 adds `.decisions` to the
/// existing `activity / logs / output / details` set.
enum RunDetailTabKind: String, CaseIterable {
    case activity
    case logs
    case output
    case decisions
    case details
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
