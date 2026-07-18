import XCTest
@testable import AgentServerCore

final class MonitorReliabilityTests: XCTestCase {
    func testSettingsCloseWhenSelectedAgentChanges() {
        XCTAssertTrue(
            AgentSettingsSelectionPolicy.shouldDismissSettings(
                previousAgentId: "agent-a",
                selectedAgentId: "agent-b"
            )
        )
    }

    func testSettingsStayOpenWhenSelectionDoesNotChange() {
        XCTAssertFalse(
            AgentSettingsSelectionPolicy.shouldDismissSettings(
                previousAgentId: "agent-a",
                selectedAgentId: "agent-a"
            )
        )
    }

    func testReconnectBackoffGrowsAndStopsAtMaximum() {
        let policy = WebSocketReconnectPolicy(initialDelay: 1, maximumDelay: 8)

        XCTAssertEqual(policy.delay(afterFailureCount: 1), 1)
        XCTAssertEqual(policy.delay(afterFailureCount: 2), 2)
        XCTAssertEqual(policy.delay(afterFailureCount: 3), 4)
        XCTAssertEqual(policy.delay(afterFailureCount: 4), 8)
        XCTAssertEqual(policy.delay(afterFailureCount: 20), 8)
    }

    func testReconnectBackoffHandlesInvalidCountsAndConfiguration() {
        let policy = WebSocketReconnectPolicy(initialDelay: 0, maximumDelay: -1)

        XCTAssertEqual(policy.delay(afterFailureCount: 0), 0)
        XCTAssertEqual(policy.delay(afterFailureCount: -1), 0)
        XCTAssertEqual(policy.delay(afterFailureCount: 3), 0)
    }

    func testDecodingFailureIsNotTreatedAsReachabilityFailure() {
        let error = DecodingError.dataCorrupted(
            .init(codingPath: [], debugDescription: "schema changed")
        )

        XCTAssertEqual(MonitorPollFailureClassifier.kind(for: error), .responseSchema)
    }

    func testTransportFailureIsTreatedAsReachabilityFailure() {
        XCTAssertEqual(
            MonitorPollFailureClassifier.kind(for: URLError(.cannotConnectToHost)),
            .reachability
        )
    }

    func testCancelledRequestDoesNotTriggerReachabilityRecovery() {
        XCTAssertEqual(
            MonitorPollFailureClassifier.kind(for: URLError(.cancelled)),
            .serverResponse
        )
    }
}
