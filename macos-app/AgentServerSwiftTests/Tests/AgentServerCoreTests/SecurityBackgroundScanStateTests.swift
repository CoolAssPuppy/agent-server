import XCTest
@testable import AgentServerCore

final class SecurityBackgroundScanStateTests: XCTestCase {
    func testScanStartsWithTheFirstAgentAndAdvancesOneAtATime() {
        let agents = [
            SecurityScanAgent(id: "alpha", name: "Alpha"),
            SecurityScanAgent(id: "beta", name: "Beta")
        ]

        let started = SecurityBackgroundScanState.scanning(agents: agents)
        let advanced = started.completingCurrentAgent()

        XCTAssertEqual(started.phase, .scanning)
        XCTAssertEqual(started.currentAgent?.id, "alpha")
        XCTAssertEqual(started.completedCount, 0)
        XCTAssertEqual(advanced.currentAgent?.id, "beta")
        XCTAssertEqual(advanced.completedCount, 1)
        XCTAssertEqual(
            advanced.agents.map(\.status),
            [.complete, .analyzing]
        )
    }

    func testCompletingTheLastAgentProducesAQuietCompletedState() {
        let started = SecurityBackgroundScanState.scanning(
            agents: [SecurityScanAgent(id: "alpha", name: "Alpha")]
        )

        let completed = started.completingCurrentAgent()

        XCTAssertEqual(completed.phase, .complete)
        XCTAssertEqual(completed.completedCount, 1)
        XCTAssertNil(completed.currentAgent)
        XCTAssertEqual(completed.notification, .none)
    }

    func testFailureProducesAnAccessibleErrorNotification() {
        let started = SecurityBackgroundScanState.scanning(
            agents: [SecurityScanAgent(id: "alpha", name: "Alpha")]
        )

        let failed = started.failing(message: "The local server is offline.")

        XCTAssertEqual(failed.phase, .failed)
        XCTAssertEqual(failed.notification, .error)
        XCTAssertEqual(failed.failureMessage, "The local server is offline.")
        XCTAssertEqual(failed.agents.map(\.status), [.failed])
    }

    func testOneAgentFailureDoesNotPreventTheNextAgentFromBeingChecked() {
        let started = SecurityBackgroundScanState.scanning(agents: [
            SecurityScanAgent(id: "alpha", name: "Alpha"),
            SecurityScanAgent(id: "beta", name: "Beta")
        ])

        let continued = started.recordingCurrentFailure(message: "Alpha could not be checked.")
        let finished = continued.completingCurrentAgent()

        XCTAssertEqual(continued.phase, .scanning)
        XCTAssertEqual(continued.currentAgent?.id, "beta")
        XCTAssertEqual(continued.agents.map(\.status), [.failed, .analyzing])
        XCTAssertEqual(finished.phase, .failed)
        XCTAssertEqual(finished.processedCount, 2)
        XCTAssertEqual(finished.notification, .error)
    }

    func testFailureDetailsSurviveLaterSuccessfulAgents() {
        let started = SecurityBackgroundScanState.scanning(agents: [
            SecurityScanAgent(id: "alpha", name: "Alpha"),
            SecurityScanAgent(id: "beta", name: "Beta"),
            SecurityScanAgent(id: "gamma", name: "Gamma")
        ])

        let finished = started
            .recordingCurrentFailure(message: "Alpha could not be checked.")
            .completingCurrentAgent()
            .completingCurrentAgent()

        XCTAssertEqual(finished.phase, .failed)
        XCTAssertEqual(finished.failureMessage, "Alpha could not be checked.")
    }

    func testCompletedScanCanReportAgentsThatNeedAttention() {
        let completed = SecurityBackgroundScanState.scanning(
            agents: [SecurityScanAgent(id: "alpha", name: "Alpha")]
        )
        .completingCurrentAgent()
        .reportingAttention(count: 1)

        XCTAssertEqual(completed.notification, .attention(count: 1))
        XCTAssertEqual(completed.accessibilitySummary, "Security check found 1 agent that needs attention")
    }

    func testFooterAttentionCountsOnlyHighAndCriticalAgents() {
        let dashboard = SecurityDashboardPresentation(agents: [
            SecurityAgentPresentation(id: "low", name: "Low", risk: .low, findingCount: 0, isStale: false),
            SecurityAgentPresentation(id: "review", name: "Review", risk: .needsReview, findingCount: 1, isStale: true),
            SecurityAgentPresentation(id: "high", name: "High", risk: .high, findingCount: 1, isStale: true),
            SecurityAgentPresentation(id: "critical", name: "Critical", risk: .critical, findingCount: 1, isStale: true)
        ])

        XCTAssertEqual(dashboard.notificationAttentionCount, 2)
    }
}
