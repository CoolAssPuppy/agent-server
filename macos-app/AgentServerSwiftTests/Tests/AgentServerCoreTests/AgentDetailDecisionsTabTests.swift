import XCTest
@testable import AgentServerCore

final class AgentDetailDecisionsTabTests: XCTestCase {

    private func decision(
        id: String,
        taskRunId: String = "run_1",
        status: DecisionStatus = .pending,
        createdAt: Date = Date(),
        resolvedAt: Date? = nil
    ) -> Decision {
        Decision(
            id: id,
            taskRunId: taskRunId,
            agentSlug: "finance-agent",
            agentName: "Finance Agent",
            type: .approve,
            title: "Decision \(id)",
            payload: DecisionPayload(
                approveLabel: nil, declineLabel: nil, recommendation: nil,
                options: nil, allowNone: nil, recommendedOptionId: nil,
                prompt: nil, placeholder: nil, suggestedAnswer: nil, maxLength: nil,
                body: nil, reasoning: nil, confidence: nil, sources: nil
            ),
            status: status,
            dueAt: nil, deferUntil: nil,
            createdAt: createdAt,
            resolvedAt: resolvedAt,
            resolvedBy: nil, resolvedVia: nil, resolution: nil
        )
    }

    func testRunDecisionsTabSeparatesPendingAndHistorical() {
        let now = Date()
        let pending = decision(id: "p1", status: .pending, createdAt: now)
        let resolvedEarlier = decision(
            id: "r1", status: .resolved,
            createdAt: now.addingTimeInterval(-3600),
            resolvedAt: now.addingTimeInterval(-3500)
        )
        let otherRun = decision(id: "x1", taskRunId: "run_OTHER", status: .pending, createdAt: now)

        let vm = RunDecisionsViewModel(runId: "run_1", decisions: [pending, resolvedEarlier, otherRun])

        XCTAssertEqual(vm.pending.map(\.id), ["p1"], "Pending list should include only pending decisions for this run")
        XCTAssertEqual(vm.history.map(\.id), ["r1"], "History should include only resolved decisions for this run")
    }

    func testRunDecisionsTabIsEmptyWhenRunHasNoDecisions() {
        let vm = RunDecisionsViewModel(runId: "run_1", decisions: [])
        XCTAssertTrue(vm.pending.isEmpty)
        XCTAssertTrue(vm.history.isEmpty)
        XCTAssertTrue(vm.isEmpty)
    }

    func testRunDecisionsHistoryIsSortedMostRecentResolvedFirst() {
        let now = Date()
        let older = decision(id: "r-old", status: .resolved, createdAt: now.addingTimeInterval(-7200), resolvedAt: now.addingTimeInterval(-7000))
        let newer = decision(id: "r-new", status: .resolved, createdAt: now.addingTimeInterval(-3600), resolvedAt: now.addingTimeInterval(-3500))

        let vm = RunDecisionsViewModel(runId: "run_1", decisions: [older, newer])
        XCTAssertEqual(vm.history.map(\.id), ["r-new", "r-old"])
    }

    func testRunDetailTabsIncludeDecisionsSubTab() {
        // Guards the enum contract used by RunDetailView tab picker.
        let expected: Set<String> = ["activity", "logs", "output", "decisions", "details"]
        XCTAssertEqual(Set(RunDetailTabKind.allCases.map(\.rawValue)), expected)
    }
}
