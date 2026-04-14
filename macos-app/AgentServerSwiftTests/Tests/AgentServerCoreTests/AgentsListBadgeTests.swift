import XCTest
@testable import AgentServerCore

final class AgentsListBadgeTests: XCTestCase {

    private func decision(id: String, agentSlug: String, status: DecisionStatus = .pending, deferUntil: Date? = nil) -> Decision {
        Decision(
            id: id,
            taskRunId: "run_\(id)",
            agentSlug: agentSlug,
            agentName: nil,
            type: .approve,
            title: "t",
            payload: DecisionPayload(
                approveLabel: nil, declineLabel: nil, recommendation: nil,
                options: nil, allowNone: nil, recommendedOptionId: nil,
                prompt: nil, placeholder: nil, suggestedAnswer: nil, maxLength: nil,
                body: nil, reasoning: nil, confidence: nil, sources: nil
            ),
            status: status,
            dueAt: nil,
            deferUntil: deferUntil,
            createdAt: Date(),
            resolvedAt: nil, resolvedBy: nil, resolvedVia: nil, resolution: nil
        )
    }

    func testAgentWithoutPendingDecisionsHasNoBadge() {
        let vm = AgentsListBadgeViewModel(decisions: [])
        XCTAssertNil(vm.badge(forAgentSlug: "finance-agent"))
    }

    func testAgentWithOnePendingDecisionShowsBadgeCountOne() {
        let vm = AgentsListBadgeViewModel(decisions: [
            decision(id: "a", agentSlug: "finance-agent"),
        ])
        XCTAssertEqual(vm.badge(forAgentSlug: "finance-agent"), 1)
    }

    func testAgentWithTwoPendingDecisionsShowsBadgeCountTwo() {
        let vm = AgentsListBadgeViewModel(decisions: [
            decision(id: "a", agentSlug: "finance-agent"),
            decision(id: "b", agentSlug: "finance-agent"),
            decision(id: "c", agentSlug: "other-agent"),
        ])
        XCTAssertEqual(vm.badge(forAgentSlug: "finance-agent"), 2)
        XCTAssertEqual(vm.badge(forAgentSlug: "other-agent"), 1)
    }

    func testResolvedDecisionsDoNotContributeToBadge() {
        let vm = AgentsListBadgeViewModel(decisions: [
            decision(id: "a", agentSlug: "finance-agent", status: .resolved),
        ])
        XCTAssertNil(vm.badge(forAgentSlug: "finance-agent"))
    }

    func testDeferredDecisionsDoNotContributeToBadge() {
        let future = Date().addingTimeInterval(3600)
        let vm = AgentsListBadgeViewModel(decisions: [
            decision(id: "a", agentSlug: "finance-agent", deferUntil: future),
        ])
        XCTAssertNil(vm.badge(forAgentSlug: "finance-agent"))
    }
}
