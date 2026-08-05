import XCTest
@testable import AgentServerCore

final class SlackPairingTests: XCTestCase {
    func testDecodesServerPairingStateWithoutDestinationIdentity() throws {
        let data = Data(#"{"state":"needs_pairing","open_url":"slack://user?team=T123&id=U123","can_open_slack":true,"can_test":false}"#.utf8)

        let status = try JSONDecoder().decode(SlackPairingStatus.self, from: data)

        XCTAssertEqual(status.state, .needsPairing)
        XCTAssertEqual(status.openURL?.scheme, "slack")
        XCTAssertTrue(status.canOpenSlack)
        XCTAssertFalse(status.canTest)
    }

    func testMapsPairingStatesToClearConsumerActions() {
        let presentations = [
            SlackPairingPresentation(status: .notConfigured),
            SlackPairingPresentation(status: .starting),
            SlackPairingPresentation(status: .needsPairing),
            SlackPairingPresentation(status: .error),
            SlackPairingPresentation(status: .ready),
        ]

        XCTAssertEqual(
            presentations.map(\.readinessTitle),
            ["Needs setup", "Starting", "Finish setup", "Needs attention", "Ready"]
        )
        XCTAssertEqual(
            presentations.map(\.actionTitle),
            ["Set up", "Starting", "Finish setup", "Manage", "Manage"]
        )
        XCTAssertEqual(
            presentations.map(\.isActionEnabled),
            [true, false, true, true, true]
        )
    }

    func testNormalizesAndValidatesSlackConversationIDs() {
        XCTAssertEqual(SlackConversationID.normalized("  D0BK0NF46AU  "), "D0BK0NF46AU")
        XCTAssertTrue(SlackConversationID.isValid("D0BK0NF46AU"))
        XCTAssertFalse(SlackConversationID.isValid("C0123456789"))
        XCTAssertFalse(SlackConversationID.isValid("G0123456789"))
        XCTAssertFalse(SlackConversationID.isValid("not-a-channel"))
        XCTAssertFalse(SlackConversationID.isValid("D123"))
    }
}
