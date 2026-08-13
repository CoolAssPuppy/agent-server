import XCTest
@testable import AgentServerCore

final class SecurityDashboardGroupingTests: XCTestCase {
    func testAgentsAreGroupedByWhatTheyNeedFromAPerson() {
        let dashboard = SecurityDashboardPresentation(agents: [
            checkedAgent(id: "waiting", risk: .high, approval: .awaitingApproval),
            checkedAgent(id: "clean", risk: .low, approval: .notRequired),
            checkedAgent(id: "approved", risk: .high, approval: .approved(nil)),
            SecurityAgentPresentation(id: "failed", name: "Failed", result: .failed(message: nil)),
        ])

        let sections = dashboard.sections()

        XCTAssertEqual(sections.map(\.group), [.needsApproval, .approved, .clean, .notChecked])
        XCTAssertEqual(sections.map(\.title), ["Needs approval", "Approved", "Clean", "Not checked"])
        XCTAssertEqual(sections[0].agents.map(\.id), ["waiting"])
        XCTAssertEqual(sections[1].agents.map(\.id), ["approved"])
        XCTAssertEqual(sections[2].agents.map(\.id), ["clean"])
        XCTAssertEqual(sections[3].agents.map(\.id), ["failed"])
    }

    func testEmptyGroupsAreLeftOutOfTheList() {
        let dashboard = SecurityDashboardPresentation(agents: [
            checkedAgent(id: "clean", risk: .low, approval: .notRequired),
        ])

        XCTAssertEqual(dashboard.sections().map(\.group), [.clean])
    }

    func testAnAgentThatChangedSinceItsApprovalNeedsApprovalAgain() {
        let agent = SecurityAgentPresentation(
            id: "changed",
            name: "Changed",
            risk: .high,
            findingCount: 2,
            isStale: true,
            approval: .approved(Date())
        )

        XCTAssertEqual(agent.group, .needsApproval)
    }

    func testAnAgentThatCannotBeApprovedStillNeedsAPerson() {
        XCTAssertEqual(checkedAgent(id: "blocked", risk: .critical, approval: .blocked).group, .needsApproval)
    }

    func testSearchNarrowsTheListWithoutLosingItsGrouping() {
        let dashboard = SecurityDashboardPresentation(agents: [
            checkedAgent(id: "inbox", name: "Inbox helper", risk: .high, approval: .awaitingApproval),
            checkedAgent(id: "index", name: "Research index", risk: .low, approval: .notRequired),
            checkedAgent(id: "inbox-clean", name: "Inbox archive", risk: .low, approval: .notRequired),
        ])

        let sections = dashboard.sections(matching: "inbox")

        XCTAssertEqual(sections.map(\.group), [.needsApproval, .clean])
        XCTAssertEqual(sections.flatMap { $0.agents.map(\.id) }, ["inbox", "inbox-clean"])
        XCTAssertEqual(dashboard.sections(matching: "nothing here").count, 0)
    }

    func testSummaryCountsOnlyTheGroupsThatHaveAgents() {
        let dashboard = SecurityDashboardPresentation(agents: [
            checkedAgent(id: "waiting", risk: .high, approval: .awaitingApproval),
            checkedAgent(id: "waiting-2", risk: .critical, approval: .blocked),
            checkedAgent(id: "clean", risk: .low, approval: .notRequired),
        ])

        let summary = dashboard.summary

        XCTAssertEqual(summary.counts.map(\.group), [.needsApproval, .clean])
        XCTAssertEqual(summary.counts.map(\.count), [2, 1])
        XCTAssertEqual(summary.headline, "2 agents need your approval")
        XCTAssertEqual(summary.detail, "3 agents checked")
    }

    func testSummarySaysSoWhenNothingIsWaitingOnAPerson() {
        let dashboard = SecurityDashboardPresentation(agents: [
            checkedAgent(id: "clean", risk: .low, approval: .notRequired),
            SecurityAgentPresentation(id: "failed", name: "Failed", result: .failed(message: nil)),
            SecurityAgentPresentation(id: "pending", name: "Pending", result: .pending),
        ])

        let summary = dashboard.summary

        XCTAssertEqual(summary.headline, "Nothing needs your approval")
        XCTAssertEqual(summary.detail, "1 agent checked, 1 could not be checked, 1 waiting")
    }

    func testSummaryOfAnEmptyDashboardSaysThereIsNothingToCheck() {
        let summary = SecurityDashboardPresentation(agents: []).summary

        XCTAssertEqual(summary.headline, "No agents to check yet")
        XCTAssertEqual(summary.detail, "")
        XCTAssertFalse(summary.showsSearch)
    }

    func testSearchAppearsOnlyWhenTheListIsLongEnoughToNeedIt() {
        let short = SecurityDashboardPresentation(
            agents: (0..<6).map { checkedAgent(id: "agent-\($0)", risk: .low, approval: .notRequired) }
        )
        let long = SecurityDashboardPresentation(
            agents: (0..<7).map { checkedAgent(id: "agent-\($0)", risk: .low, approval: .notRequired) }
        )

        XCTAssertFalse(short.summary.showsSearch)
        XCTAssertTrue(long.summary.showsSearch)
    }

    // MARK: - Rows

    func testARowStatesItsStatusOnce() {
        let waiting = SecurityAgentPresentation(
            id: "waiting",
            name: "Friday summary",
            risk: .high,
            findingCount: 3,
            isStale: false,
            approval: .awaitingApproval
        ).securityRow(isSelected: false)

        XCTAssertEqual(waiting.title, "Friday summary")
        XCTAssertEqual(waiting.detail, "3 things to review")
        XCTAssertEqual(waiting.status, "High risk")
        XCTAssertEqual(waiting.severity, .high)
    }

    func testApprovedAndCleanRowsLeaveTheStatusToTheirGroupHeading() {
        let approved = checkedAgent(id: "approved", risk: .high, approval: .approved(nil))
            .securityRow(isSelected: false)
        let clean = checkedAgent(id: "clean", risk: .low, approval: .notRequired)
            .securityRow(isSelected: false)

        XCTAssertEqual(approved.status, "")
        XCTAssertEqual(approved.detail, "")
        XCTAssertNil(approved.severity)
        XCTAssertEqual(clean.status, "")
        XCTAssertEqual(clean.detail, "")
    }

    func testARowThatChangedSinceApprovalSaysSoInsteadOfNamingItsRisk() {
        let row = SecurityAgentPresentation(
            id: "changed",
            name: "Changed",
            risk: .high,
            findingCount: 1,
            isStale: true,
            approval: .approved(Date())
        ).securityRow(isSelected: false)

        XCTAssertEqual(row.status, "Changed since review")
        XCTAssertEqual(row.detail, "1 thing to review")
    }

    func testUncheckedRowsKeepTheirReason() {
        let failed = SecurityAgentPresentation(
            id: "failed",
            name: "Failed",
            result: .failed(message: "The local server did not answer.")
        ).securityRow(isSelected: false)
        let pending = SecurityAgentPresentation(id: "pending", name: "Pending", result: .pending)
            .securityRow(isSelected: false)

        XCTAssertEqual(failed.status, "Could not check")
        XCTAssertEqual(failed.detail, "The local server did not answer.")
        XCTAssertEqual(pending.status, "Waiting")
        XCTAssertEqual(pending.detail, "")
    }

    // MARK: - Approve and advance

    func testTheApprovalQueueFollowsTheOrderOfTheNeedsApprovalGroup() {
        let queue = SecurityApprovalQueue(dashboard: SecurityDashboardPresentation(agents: [
            checkedAgent(id: "first", risk: .high, approval: .awaitingApproval),
            checkedAgent(id: "clean", risk: .low, approval: .notRequired),
            checkedAgent(id: "second", risk: .critical, approval: .blocked),
        ]))

        XCTAssertEqual(queue.agentIds, ["first", "second"])
        XCTAssertEqual(queue.next(after: "first"), "second")
        XCTAssertNil(queue.next(after: "second"))
    }

    func testApprovingTheLastAgentLeavesNowhereToAdvanceTo() {
        let queue = SecurityApprovalQueue(agentIds: ["only"])

        XCTAssertNil(queue.next(after: "only"))
        XCTAssertEqual(queue.approveActionTitle(after: "only"), "Approve automatic runs")
    }

    func testApprovingAnAgentAdvancesToTheNextOneInTheBacklog() {
        let queue = SecurityApprovalQueue(agentIds: ["first", "second", "third"])

        XCTAssertEqual(queue.next(after: "first"), "second")
        XCTAssertEqual(queue.approveActionTitle(after: "first"), "Approve and go to the next agent")
        XCTAssertEqual(queue.remaining(after: "second"), 1)
    }

    func testAnAgentAlreadyOutOfTheBacklogAdvancesToWhateverIsStillWaiting() {
        let queue = SecurityApprovalQueue(agentIds: ["still-waiting"])

        XCTAssertEqual(queue.next(after: "already-approved"), "still-waiting")
        XCTAssertEqual(queue.remaining(after: "already-approved"), 1)
        XCTAssertNil(SecurityApprovalQueue(agentIds: []).next(after: "already-approved"))
    }

    // MARK: - Approval state

    func testApprovalStateFollowsWhatTheServerSaysAboutAutomaticRuns() {
        XCTAssertEqual(
            SecurityApprovalState(
                risk: .critical,
                isStale: false,
                isReviewed: true,
                reviewedAt: nil,
                automaticRuns: .blocked
            ),
            .blocked
        )
        XCTAssertEqual(
            SecurityApprovalState(
                risk: .low,
                isStale: false,
                isReviewed: false,
                reviewedAt: nil,
                automaticRuns: .reviewRequired
            ),
            .awaitingApproval
        )
    }

    func testAReviewedAgentIsApprovedUntilItChanges() {
        let reviewedAt = Date(timeIntervalSince1970: 1_770_000_000)

        XCTAssertEqual(
            SecurityApprovalState(
                risk: .high,
                isStale: false,
                isReviewed: true,
                reviewedAt: reviewedAt,
                automaticRuns: .allowed
            ),
            .approved(reviewedAt)
        )
        XCTAssertEqual(
            SecurityApprovalState(
                risk: .high,
                isStale: true,
                isReviewed: true,
                reviewedAt: reviewedAt,
                automaticRuns: nil
            ),
            .awaitingApproval
        )
    }

    func testAnAgentWithNothingToApproveNeedsNoApproval() {
        XCTAssertEqual(
            SecurityApprovalState(
                risk: .low,
                isStale: false,
                isReviewed: false,
                reviewedAt: nil,
                automaticRuns: nil
            ),
            .notRequired
        )
        XCTAssertEqual(
            SecurityApprovalState(
                risk: .needsReview,
                isStale: false,
                isReviewed: false,
                reviewedAt: nil,
                automaticRuns: nil
            ),
            .awaitingApproval
        )
    }

    // MARK: - Helpers

    private func checkedAgent(
        id: String,
        name: String? = nil,
        risk: ConsumerRiskLevel,
        approval: SecurityApprovalState
    ) -> SecurityAgentPresentation {
        SecurityAgentPresentation(
            id: id,
            name: name ?? id,
            risk: risk,
            findingCount: risk == .low ? 0 : 1,
            isStale: false,
            approval: approval
        )
    }
}
