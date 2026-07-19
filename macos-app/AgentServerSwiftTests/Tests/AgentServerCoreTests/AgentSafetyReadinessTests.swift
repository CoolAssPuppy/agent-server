import XCTest
@testable import AgentServerCore

final class AgentSafetyReadinessTests: XCTestCase {
    func testMissingConnectionsTakePriorityBecauseTheAgentCannotRunYet() {
        let presentation = AgentSafetyReadinessPresentation(
            securityResult: .checked(risk: .low, findingCount: 0, isStale: false),
            missingConnectionCount: 2
        )

        XCTAssertEqual(presentation.title, "Needs setup")
        XCTAssertEqual(presentation.detail, "2 connected apps need attention before this agent can run.")
        XCTAssertEqual(presentation.action, .openSettings)
    }

    func testCheckedAgentShowsRiskAndFindingCountInPlainLanguage() {
        let presentation = AgentSafetyReadinessPresentation(
            securityResult: .checked(risk: .high, findingCount: 3, isStale: false),
            missingConnectionCount: 0
        )

        XCTAssertEqual(presentation.title, "High risk")
        XCTAssertEqual(presentation.detail, "3 security findings need review.")
        XCTAssertEqual(presentation.action, .reviewSecurity)
    }

    func testStaleReviewExplainsThatTheAgentChanged() {
        let presentation = AgentSafetyReadinessPresentation(
            securityResult: .checked(risk: .low, findingCount: 0, isStale: true),
            missingConnectionCount: 0
        )

        XCTAssertEqual(presentation.title, "Needs another review")
        XCTAssertEqual(presentation.detail, "This agent changed after its last security check.")
        XCTAssertEqual(presentation.action, .reviewSecurity)
    }

    func testFailedAndPendingChecksRemainDistinct() {
        let failed = AgentSafetyReadinessPresentation(
            securityResult: .failed(message: "The local check timed out."),
            missingConnectionCount: 0
        )
        let pending = AgentSafetyReadinessPresentation(
            securityResult: .pending,
            missingConnectionCount: 0
        )

        XCTAssertEqual(failed.title, "Security check did not finish")
        XCTAssertEqual(failed.detail, "The local check timed out.")
        XCTAssertEqual(pending.title, "Safety not checked yet")
        XCTAssertNotEqual(failed.title, pending.title)
    }
}
