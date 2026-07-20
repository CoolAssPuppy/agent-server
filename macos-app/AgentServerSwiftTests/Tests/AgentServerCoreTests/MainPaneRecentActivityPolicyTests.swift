import XCTest
@testable import AgentServerCore

final class MainPaneRecentActivityPolicyTests: XCTestCase {
    func testRecentActivityFiltersChatRunsBeforeTakingTheFirstSevenVisibleRuns() {
        let runs = [
            fixture("chat-1", conversationID: "conversation-1"),
            fixture("visible-1"),
            fixture("chat-2", conversationID: "conversation-2"),
            fixture("visible-2"),
            fixture("chat-3", conversationID: "conversation-3"),
            fixture("visible-3"),
            fixture("visible-4"),
            fixture("visible-5"),
            fixture("visible-6"),
            fixture("visible-7"),
            fixture("visible-8")
        ]

        let visibleRuns = MainPaneRecentActivityPolicy.visibleItems(
            from: runs,
            conversationID: \.conversationID
        )

        XCTAssertEqual(
            visibleRuns.map(\.id),
            ["visible-1", "visible-2", "visible-3", "visible-4", "visible-5", "visible-6", "visible-7"]
        )
    }

    func testAnyConversationIdentifierKeepsARunOutOfHomeActivity() {
        let runs = [
            fixture("visible"),
            fixture("empty-conversation", conversationID: "")
        ]

        let visibleRuns = MainPaneRecentActivityPolicy.visibleItems(
            from: runs,
            conversationID: \.conversationID
        )

        XCTAssertEqual(visibleRuns.map(\.id), ["visible"])
    }

    private func fixture(
        _ id: String,
        conversationID: String? = nil
    ) -> ActivityFixture {
        ActivityFixture(id: id, conversationID: conversationID)
    }
}

private struct ActivityFixture {
    let id: String
    let conversationID: String?
}
