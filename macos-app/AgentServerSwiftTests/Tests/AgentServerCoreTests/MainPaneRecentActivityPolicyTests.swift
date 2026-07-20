import XCTest
@testable import AgentServerCore

final class MainPaneRecentActivityPolicyTests: XCTestCase {
    func testHomeReservesElevationForUpNextAndKeepsActivityFlat() {
        XCTAssertEqual(MainPaneVisualPolicy.elevatedRegion, .upNext)
        XCTAssertEqual(MainPaneVisualPolicy.activitySurface, .groupedRows)
    }

    func testRecentActivityGroupsConversationTurnsBeforeApplyingItsLimit() {
        let newest = Date(timeIntervalSince1970: 300)
        let oldest = Date(timeIntervalSince1970: 100)
        let runs = [
            fixture("chat-new", conversationID: "conversation-1", channel: "slack", startedAt: newest),
            fixture("visible", startedAt: Date(timeIntervalSince1970: 200)),
            fixture("chat-old", conversationID: "conversation-1", channel: "slack", startedAt: oldest),
            fixture("telegram", conversationID: "conversation-2", channel: "telegram", startedAt: oldest)
        ]

        let items = MainPaneRecentActivityPolicy.groupedItems(
            from: runs,
            itemID: \.id,
            conversationID: \.conversationID,
            conversationChannel: \.channel,
            startedAt: \.startedAt
        )

        XCTAssertEqual(items.map(\.id), ["conversation:conversation-1", "run:visible", "conversation:conversation-2"])
        XCTAssertEqual(
            items[0].kind,
            .conversation(channel: "slack", startedAt: oldest, runCount: 2)
        )
        XCTAssertEqual(items[1].kind, .run)
        XCTAssertEqual(items[2].kind, .conversation(channel: "telegram", startedAt: oldest, runCount: 1))
    }

    func testConversationTitleUsesTheRecordedChannelWithoutExposingImplementationTerms() {
        XCTAssertEqual(
            ConversationActivityPresentation.title(
                channel: "slack",
                formattedDate: "Jul 20 at 10:42 AM"
            ),
            "Slack conversation from Jul 20 at 10:42 AM"
        )
        XCTAssertEqual(
            ConversationActivityPresentation.title(
                channel: nil,
                formattedDate: "Jul 20 at 10:42 AM"
            ),
            "Conversation from Jul 20 at 10:42 AM"
        )
    }

    private func fixture(
        _ id: String,
        conversationID: String? = nil,
        channel: String? = nil,
        startedAt: Date = Date(timeIntervalSince1970: 0)
    ) -> ActivityFixture {
        ActivityFixture(id: id, conversationID: conversationID, channel: channel, startedAt: startedAt)
    }
}

private struct ActivityFixture {
    let id: String
    let conversationID: String?
    let channel: String?
    let startedAt: Date
}
