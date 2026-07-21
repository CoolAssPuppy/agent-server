import XCTest
@testable import AgentServerCore

final class AgentDetailPresentationTests: XCTestCase {
    func testTabsUseTheRequestedOrderAndLabels() {
        XCTAssertEqual(AgentDetailTab.allCases, [.recentRuns, .editAgent, .runHistory])
        XCTAssertEqual(AgentDetailTab.allCases.map(\.title), [
            "Recent runs", "Edit agent", "Run history",
        ])
    }

    func testSelectingTabsReplacesOneContentSurface() {
        var state = AgentDetailPresentationState(agentId: "writer")

        XCTAssertEqual(state.sections, [.lastRun, .capabilities])
        state.select(.editAgent)
        XCTAssertEqual(state.sections, [.agentEditor])
        state.select(.runHistory)
        XCTAssertEqual(state.sections, [.runHistory])
    }

    func testSelectingAnotherAgentReturnsToRecentRunsAndClearsTheSelectedRun() {
        var state = AgentDetailPresentationState(agentId: "writer")
        state.openRun(id: "run-1")

        state.selectAgent(id: "researcher")

        XCTAssertEqual(state.selectedTab, .recentRuns)
        XCTAssertNil(state.selectedRunId)
    }

    func testOpeningALastRunSelectsRunHistoryAndPreservesItsIdentity() {
        var state = AgentDetailPresentationState(agentId: "writer")

        state.openRun(id: "run-42")

        XCTAssertEqual(state.selectedTab, .runHistory)
        XCTAssertEqual(state.selectedRunId, "run-42")
    }

    func testRunActionUsesPlayUntilStartingOrRunning() {
        let idle = AgentDetailHeaderRunPresentation(isAgentEnabled: true, isRunning: false)
        let running = AgentDetailHeaderRunPresentation(isAgentEnabled: true, isRunning: true)
        let paused = AgentDetailHeaderRunPresentation(isAgentEnabled: false, isRunning: false)

        XCTAssertEqual(idle.symbol, "play.fill")
        XCTAssertEqual(idle.tone, .standard)
        XCTAssertFalse(idle.isDisabled)
        XCTAssertEqual(running.symbol, "arrow.triangle.2.circlepath")
        XCTAssertEqual(running.tone, .highlight)
        XCTAssertTrue(running.isDisabled)
        XCTAssertTrue(paused.isDisabled)
        XCTAssertEqual(paused.help, "Enable this agent before running it")
    }

    func testOnlyCurrentLowRiskWithoutFindingsIsGood() {
        let good = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .low, findingCount: 0, isStale: false),
            missingConnectionCount: 0
        )
        let finding = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .low, findingCount: 1, isStale: false),
            missingConnectionCount: 0
        )
        let stale = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .low, findingCount: 0, isStale: true),
            missingConnectionCount: 0
        )

        XCTAssertEqual(good.tone, .good)
        XCTAssertEqual(good.symbol, "checkmark.shield")
        XCTAssertEqual(good.help, "Security check found no issues.")
        XCTAssertEqual(finding.tone, .warning)
        XCTAssertEqual(stale.tone, .warning)
    }

    func testSecurityIndicatorUsesOrangeForAttentionAndRedOnlyForCritical() {
        let pending = AgentDetailSecurityIndicatorPresentation(
            result: .pending,
            missingConnectionCount: 0
        )
        let high = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .high, findingCount: 2, isStale: false),
            missingConnectionCount: 0
        )
        let critical = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .critical, findingCount: 1, isStale: false),
            missingConnectionCount: 0
        )
        let missingConnection = AgentDetailSecurityIndicatorPresentation(
            result: .checked(risk: .low, findingCount: 0, isStale: false),
            missingConnectionCount: 1
        )

        XCTAssertEqual(pending.tone, .warning)
        XCTAssertEqual(high.tone, .warning)
        XCTAssertEqual(critical.tone, .critical)
        XCTAssertEqual(critical.symbol, "xmark.shield.fill")
        XCTAssertEqual(missingConnection.tone, .warning)
        XCTAssertEqual(missingConnection.help, "1 connected app needs attention.")
    }
}
