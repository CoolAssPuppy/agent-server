import XCTest
@testable import AgentServerCore

final class SidebarSortTests: XCTestCase {

    private func agent(_ id: String, _ name: String, slug: String? = nil) -> SidebarAgent {
        SidebarAgent(
            id: id,
            slug: slug ?? id,
            name: name,
            description: nil,
            scheduleLabel: nil,
            kind: .scheduled,
            lastRunFailed: false
        )
    }

    func testAlphabeticalSortByNameCaseInsensitive() {
        let agents = [agent("3", "charlie"), agent("1", "Alpha"), agent("2", "bravo")]
        let rows = SidebarSort.sortedRows(
            agents: agents,
            runningAgentIds: [],
            pendingDecisions: []
        )
        XCTAssertEqual(rows.map(\.id), ["1", "2", "3"])
        XCTAssertTrue(rows.allSatisfy { $0.state == .idle })
    }

    func testRunningAgentsGlideToTopWithAlphabeticalWithinBucket() {
        let agents = [
            agent("a", "Alpha"),
            agent("b", "Bravo"),
            agent("c", "Charlie"),
            agent("d", "Delta"),
            agent("e", "Echo"),
        ]
        let rows = SidebarSort.sortedRows(
            agents: agents,
            runningAgentIds: ["d", "b"],
            pendingDecisions: []
        )
        XCTAssertEqual(rows.map(\.id), ["b", "d", "a", "c", "e"])
        XCTAssertEqual(rows[0].state, .running)
        XCTAssertEqual(rows[1].state, .running)
        XCTAssertEqual(rows[2].state, .idle)
    }

    func testNeedsYouStateIsDerivedFromPendingDecisions() {
        let now = Date()
        let decision = Decision(
            id: "d1",
            taskRunId: "r1",
            agentSlug: "finance",
            agentName: nil,
            type: .approve,
            title: "t",
            payload: DecisionPayload(
                approveLabel: nil, declineLabel: nil, recommendation: nil,
                options: nil, allowNone: nil, recommendedOptionId: nil,
                prompt: nil, placeholder: nil, suggestedAnswer: nil, maxLength: nil,
                body: nil, reasoning: nil, confidence: nil, sources: nil
            ),
            status: .pending,
            dueAt: nil, deferUntil: nil,
            createdAt: now,
            resolvedAt: nil, resolvedBy: nil, resolvedVia: nil, resolution: nil
        )

        let rows = SidebarSort.sortedRows(
            agents: [SidebarAgent(id: "f", slug: "finance", name: "Finance", description: nil, scheduleLabel: nil, kind: .scheduled, lastRunFailed: false)],
            runningAgentIds: [],
            pendingDecisions: [decision]
        )
        XCTAssertEqual(rows.first?.state, .needsYou)
        XCTAssertEqual(rows.first?.pendingDecisionCount, 1)
    }

    func testRunningStateWinsOverNeedsYou() {
        let decision = Decision(
            id: "d1",
            taskRunId: "r1",
            agentSlug: "finance",
            agentName: nil,
            type: .approve,
            title: "t",
            payload: DecisionPayload(
                approveLabel: nil, declineLabel: nil, recommendation: nil,
                options: nil, allowNone: nil, recommendedOptionId: nil,
                prompt: nil, placeholder: nil, suggestedAnswer: nil, maxLength: nil,
                body: nil, reasoning: nil, confidence: nil, sources: nil
            ),
            status: .pending,
            dueAt: nil, deferUntil: nil,
            createdAt: Date(),
            resolvedAt: nil, resolvedBy: nil, resolvedVia: nil, resolution: nil
        )

        let rows = SidebarSort.sortedRows(
            agents: [SidebarAgent(id: "f", slug: "finance", name: "Finance", description: nil, scheduleLabel: nil, kind: .scheduled, lastRunFailed: false)],
            runningAgentIds: ["f"],
            pendingDecisions: [decision]
        )
        XCTAssertEqual(rows.first?.state, .running)
        XCTAssertEqual(rows.first?.pendingDecisionCount, 1)
    }
}
