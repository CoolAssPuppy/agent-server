import XCTest
@testable import AgentServerCore

final class RunSelectionCoordinatorTests: XCTestCase {
    func testLatestSelectedRunAcceptsItsOwnResponses() throws {
        var coordinator = RunSelectionCoordinator()

        let request = try XCTUnwrap(coordinator.select("run-1"))

        XCTAssertTrue(coordinator.accepts(request))
    }

    func testResponseForThePreviousRunIsRejectedAfterSelectionChanges() throws {
        var coordinator = RunSelectionCoordinator()
        let firstRequest = try XCTUnwrap(coordinator.select("run-1"))

        let secondRequest = try XCTUnwrap(coordinator.select("run-2"))

        XCTAssertFalse(coordinator.accepts(firstRequest))
        XCTAssertTrue(coordinator.accepts(secondRequest))
    }

    func testClearingSelectionRejectsAnInFlightResponse() throws {
        var coordinator = RunSelectionCoordinator()
        let request = try XCTUnwrap(coordinator.select("run-1"))

        XCTAssertNil(coordinator.select(nil))
        XCTAssertFalse(coordinator.accepts(request))
    }

    func testSelectingTheSameRunAgainCreatesANewRequestIdentity() throws {
        var coordinator = RunSelectionCoordinator()
        let firstRequest = try XCTUnwrap(coordinator.select("run-1"))

        let secondRequest = try XCTUnwrap(coordinator.select("run-1"))

        XCTAssertNotEqual(firstRequest, secondRequest)
        XCTAssertFalse(coordinator.accepts(firstRequest))
        XCTAssertTrue(coordinator.accepts(secondRequest))
    }

    func testLockContentionRetryCannotHideAnEarlierCompletedRun() {
        let completed = RunOutcomeCandidate(
            id: "original",
            startedAt: Date(timeIntervalSince1970: 100),
            status: "completed",
            code: nil
        )
        let skippedRetry = RunOutcomeCandidate(
            id: "retry",
            startedAt: Date(timeIntervalSince1970: 110),
            status: "skipped",
            code: "lock_contention"
        )

        XCTAssertEqual(
            RunOutcomeSelection.latestMeaningfulRun(in: [skippedRetry, completed])?.id,
            "original"
        )
    }

    func testSecurityReviewSkipRemainsAVisibleAgentOutcome() {
        let completed = RunOutcomeCandidate(
            id: "completed",
            startedAt: Date(timeIntervalSince1970: 100),
            status: "completed",
            code: nil
        )
        let blocked = RunOutcomeCandidate(
            id: "blocked",
            startedAt: Date(timeIntervalSince1970: 110),
            status: "skipped",
            code: "security_review_required"
        )

        XCTAssertEqual(
            RunOutcomeSelection.latestMeaningfulRun(in: [completed, blocked])?.id,
            "blocked"
        )
    }

    func testRunningRunsAreNotAgentOutcomes() {
        let running = RunOutcomeCandidate(
            id: "running",
            startedAt: Date(timeIntervalSince1970: 110),
            status: "running",
            code: nil
        )
        let failed = RunOutcomeCandidate(
            id: "failed",
            startedAt: Date(timeIntervalSince1970: 100),
            status: "failed",
            code: nil
        )

        XCTAssertEqual(
            RunOutcomeSelection.latestMeaningfulRun(in: [running, failed])?.id,
            "failed"
        )
    }
}
