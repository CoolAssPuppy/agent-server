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

    func testDraftCanOnlySaveToTheAgentThatSeededIt() {
        XCTAssertTrue(
            AgentSettingsSelectionPolicy.canSaveDraft(
                seededAgentId: "agent-a",
                targetAgentId: "agent-a"
            )
        )
        XCTAssertFalse(
            AgentSettingsSelectionPolicy.canSaveDraft(
                seededAgentId: "agent-a",
                targetAgentId: "agent-b"
            )
        )
        XCTAssertFalse(
            AgentSettingsSelectionPolicy.canSaveDraft(
                seededAgentId: nil,
                targetAgentId: "agent-a"
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

    func testReconnectStateResetsBackoffOnlyAfterConfirmedOpen() {
        var state = WebSocketReconnectState(
            policy: WebSocketReconnectPolicy(initialDelay: 1, maximumDelay: 8)
        )

        XCTAssertEqual(state.recordFailure(), 1)
        XCTAssertEqual(state.recordFailure(), 2)
        state.startedConnecting()
        XCTAssertEqual(state.failureCount, 2)
        XCTAssertFalse(state.isOpen)

        state.confirmedOpen()

        XCTAssertEqual(state.failureCount, 0)
        XCTAssertTrue(state.isOpen)
        XCTAssertEqual(state.recordFailure(), 1)
    }

    func testCoalescingRequestStateRunsOneFollowUpForConcurrentRequests() {
        var state = CoalescingRequestState()

        XCTAssertTrue(state.request())
        XCTAssertFalse(state.request())
        XCTAssertFalse(state.request())
        XCTAssertTrue(state.complete())
        XCTAssertFalse(state.complete())
        XCTAssertTrue(state.request())
        XCTAssertFalse(state.complete())
    }

    func testCoalescingRequestStateCanResetAfterCancellation() {
        var state = CoalescingRequestState()
        XCTAssertTrue(state.request())
        XCTAssertFalse(state.request())

        state.reset()

        XCTAssertTrue(state.request())
        XCTAssertFalse(state.complete())
    }

    func testDecodingFailureIsNotTreatedAsReachabilityFailure() {
        let error = DecodingError.dataCorrupted(
            .init(codingPath: [], debugDescription: "schema changed")
        )

        XCTAssertEqual(MonitorPollFailureClassifier.kind(for: error), .responseSchema)
    }

    func testMissingLocalAuthenticationHasItsOwnFailureKind() {
        XCTAssertEqual(
            MonitorPollFailureClassifier.kind(
                for: LocalAPIAuthenticationError.missingAPIKey
            ),
            .authenticationSetup
        )
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

    func testBoundedIdentifierHistoryEvictsTheOldestIdentifier() {
        var history = BoundedIdentifierHistory(limit: 2)

        XCTAssertTrue(history.insert("run-a"))
        XCTAssertTrue(history.insert("run-b"))
        XCTAssertFalse(history.insert("run-b"))
        XCTAssertTrue(history.insert("run-c"))

        XCTAssertFalse(history.contains("run-a"))
        XCTAssertTrue(history.contains("run-b"))
        XCTAssertTrue(history.contains("run-c"))
        XCTAssertEqual(history.count, 2)
    }
}
