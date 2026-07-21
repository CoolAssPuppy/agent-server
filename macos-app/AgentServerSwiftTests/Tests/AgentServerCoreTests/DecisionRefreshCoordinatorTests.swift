import XCTest
@testable import AgentServerCore

final class DecisionRefreshCoordinatorTests: XCTestCase {
    func testConcurrentRefreshRequestsCoalesceIntoOneFollowUp() throws {
        var coordinator = DecisionRefreshCoordinator()

        let first = try XCTUnwrap(coordinator.requestRefresh())
        XCTAssertNil(coordinator.requestRefresh())
        XCTAssertNil(coordinator.requestRefresh())

        let completion = coordinator.finishRefresh(first)
        XCTAssertTrue(completion.shouldApply)
        let followUp = try XCTUnwrap(completion.followUp)

        let finalCompletion = coordinator.finishRefresh(followUp)
        XCTAssertTrue(finalCompletion.shouldApply)
        XCTAssertNil(finalCompletion.followUp)
    }

    func testStopInvalidatesAnActiveRefreshAndAllowsRestart() throws {
        var coordinator = DecisionRefreshCoordinator()
        let stoppedRefresh = try XCTUnwrap(coordinator.requestRefresh())

        coordinator.stop()

        let staleCompletion = coordinator.finishRefresh(stoppedRefresh)
        XCTAssertFalse(staleCompletion.shouldApply)
        XCTAssertNil(staleCompletion.followUp)

        let restartedRefresh = try XCTUnwrap(coordinator.requestRefresh())
        XCTAssertNotEqual(restartedRefresh, stoppedRefresh)
        XCTAssertTrue(coordinator.finishRefresh(restartedRefresh).shouldApply)
    }

    func testOlderGenerationCannotCommitAfterRestart() throws {
        var coordinator = DecisionRefreshCoordinator()
        let oldRefresh = try XCTUnwrap(coordinator.requestRefresh())

        coordinator.stop()
        let currentRefresh = try XCTUnwrap(coordinator.requestRefresh())

        XCTAssertFalse(coordinator.finishRefresh(oldRefresh).shouldApply)
        XCTAssertTrue(coordinator.finishRefresh(currentRefresh).shouldApply)
    }

    func testFailedResolutionCanBeRetriedWithoutRemovingDecision() throws {
        var transaction = DecisionResolutionTransaction()

        let first = try XCTUnwrap(transaction.begin(decisionId: "decision-1"))
        XCTAssertNil(transaction.begin(decisionId: "decision-1"))
        XCTAssertEqual(transaction.finish(first, succeeded: false), false)
        XCTAssertNotNil(transaction.begin(decisionId: "decision-1"))
    }

    func testSuccessfulResolutionCommitsExactlyOnce() throws {
        var transaction = DecisionResolutionTransaction()

        let token = try XCTUnwrap(transaction.begin(decisionId: "decision-1"))
        XCTAssertEqual(transaction.finish(token, succeeded: true), true)
        XCTAssertNil(transaction.finish(token, succeeded: true))
    }

    func testCancelledResolutionCannotCommitIntoANewGeneration() throws {
        var transaction = DecisionResolutionTransaction()
        let stale = try XCTUnwrap(transaction.begin(decisionId: "decision-1"))

        transaction.cancelAll()
        let current = try XCTUnwrap(transaction.begin(decisionId: "decision-1"))

        XCTAssertNil(transaction.finish(stale, succeeded: true))
        XCTAssertEqual(transaction.finish(current, succeeded: true), true)
    }
}
