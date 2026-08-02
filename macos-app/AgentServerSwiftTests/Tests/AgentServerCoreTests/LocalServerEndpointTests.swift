import XCTest
@testable import AgentServerCore

final class LocalServerEndpointTests: XCTestCase {
    func testUsesTheIPv4LoopbackAddressBoundByTheDaemon() {
        XCTAssertEqual(LocalServerEndpoint.httpURL(port: 47821)?.absoluteString, "http://127.0.0.1:47821")
        XCTAssertEqual(LocalServerEndpoint.webSocketURL(port: 47821)?.absoluteString, "ws://127.0.0.1:47821/ws")
    }

    func testBuildsTheAuthenticatedLocalRunReviewPath() {
        XCTAssertEqual(
            LocalServerEndpoint.runReviewPath(runID: "e566a8f5-becf-49e7-a384-a72d42e9f807"),
            "/runs/e566a8f5-becf-49e7-a384-a72d42e9f807/review"
        )
    }

    func testBuildsTheAuthenticatedTodayAndActivitySnapshotPath() {
        XCTAssertEqual(
            LocalServerEndpoint.todayActivityPath,
            "/presentation/today-activity"
        )
    }

    func testBuildsTheAuthenticatedMachineIdentityPath() {
        XCTAssertEqual(LocalServerEndpoint.machinePath, "/machine")
    }

    func testBuildsTheAuthenticatedAssistantHomePathWithEncodedIdentity() {
        XCTAssertEqual(
            LocalServerEndpoint.assistantHomePath(assistantID: "weekly report/primary"),
            "/presentation/assistants/weekly%20report%2Fprimary"
        )
    }

    func testBuildsAuthenticatedInteractionPaths() {
        XCTAssertEqual(
            LocalServerEndpoint.interactionPath(interactionID: "interaction-1"),
            "/interactions/interaction-1"
        )
        XCTAssertEqual(
            LocalServerEndpoint.interactionReplyPath(interactionID: "interaction-1"),
            "/interactions/interaction-1/reply"
        )
    }
}
