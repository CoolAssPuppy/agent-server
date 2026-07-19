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
}
