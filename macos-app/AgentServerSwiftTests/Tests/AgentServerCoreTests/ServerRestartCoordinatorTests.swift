import XCTest
@testable import AgentServerCore

final class ServerRestartCoordinatorTests: XCTestCase {
    func testDefersAndCoalescesRequestsUntilRunsFinish() {
        var coordinator = ServerRestartCoordinator()
        coordinator.observeRunning(startedAt: "old")

        XCTAssertFalse(coordinator.requestRestart(activeRunCount: 2))
        XCTAssertFalse(coordinator.requestRestart(activeRunCount: 2))
        XCTAssertEqual(coordinator.state, .pending(activeRunCount: 2))
        XCTAssertFalse(coordinator.activeRunCountChanged(to: 1))
        XCTAssertTrue(coordinator.activeRunCountChanged(to: 0))
        XCTAssertEqual(coordinator.state, .restarting(previousStartedAt: "old"))
    }

    func testAcceptsOnlyCompatibleHealthFromANewServerInstance() {
        var coordinator = ServerRestartCoordinator(requiredAPIVersion: 12)
        coordinator.observeRunning(startedAt: "old")
        XCTAssertTrue(coordinator.requestRestart(activeRunCount: 0))

        XCTAssertFalse(coordinator.observeRestartHealth(startedAt: "old", apiVersion: 12))
        XCTAssertFalse(coordinator.observeRestartHealth(startedAt: "new", apiVersion: 11))
        XCTAssertFalse(coordinator.observeRestartHealth(startedAt: nil, apiVersion: 12))
        XCTAssertTrue(coordinator.observeRestartHealth(startedAt: "new", apiVersion: 12))
        XCTAssertEqual(coordinator.state, .running(startedAt: "new"))
    }

    func testRequestDuringRestartSchedulesOneFollowUpRestart() {
        var coordinator = ServerRestartCoordinator()
        coordinator.observeRunning(startedAt: "first")
        XCTAssertTrue(coordinator.requestRestart(activeRunCount: 0))
        XCTAssertFalse(coordinator.requestRestart(activeRunCount: 0))

        XCTAssertFalse(coordinator.observeRestartHealth(startedAt: "second", apiVersion: 13))
        XCTAssertEqual(coordinator.state, .restarting(previousStartedAt: "second"))
        XCTAssertTrue(coordinator.observeRestartHealth(startedAt: "third", apiVersion: 13))
        XCTAssertEqual(coordinator.state, .running(startedAt: "third"))
    }

    func testFailureKeepsRestartAvailableForRetry() {
        var coordinator = ServerRestartCoordinator()
        coordinator.observeRunning(startedAt: "old")
        XCTAssertTrue(coordinator.requestRestart(activeRunCount: 0))

        coordinator.restartFailed(message: "The server did not become ready.")
        XCTAssertEqual(coordinator.state, .failed(message: "The server did not become ready."))
        XCTAssertTrue(coordinator.retry(activeRunCount: 0))
        XCTAssertEqual(coordinator.state, .restarting(previousStartedAt: "old"))
    }

    func testPresentsEachLifecycleStateWithAStableConsumerLabel() {
        let states: [LocalServerLifecycleState] = [
            .running(startedAt: "now"),
            .pending(activeRunCount: 2),
            .restarting(previousStartedAt: "old"),
            .failed(message: "Failed"),
            .unavailable,
        ]

        XCTAssertEqual(
            states.map { LocalServerLifecyclePresentation(state: $0).label },
            ["Running", "Restart pending", "Restarting", "Restart failed", "Offline"]
        )
        XCTAssertEqual(
            states.map { LocalServerLifecyclePresentation(state: $0).isHealthy },
            [true, true, false, false, false]
        )
    }
}
