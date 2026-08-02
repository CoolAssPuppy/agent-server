import XCTest
@testable import AgentServerCore

final class LocalInteractionContractTests: XCTestCase {
    func testDecodesOnlyTheSafePendingInteractionProjection() throws {
        let projection = try JSONDecoder().decode(LocalInteraction.self, from: Data("""
        {
          "interaction_id": "interaction-1",
          "run_id": "run-1",
          "assistant_id": "request-agent",
          "message": "Where should I save the report?",
          "options": [
            {
              "index": 0,
              "label": "Team page",
              "description": "Share it with the team."
            },
            {
              "index": 3,
              "label": "Private notes"
            }
          ],
          "allows_free_text": true,
          "expires_at": "2026-08-02T11:00:00.000Z",
          "status": "pending"
        }
        """.utf8))

        XCTAssertEqual(projection.interactionID, "interaction-1")
        XCTAssertEqual(projection.runID, "run-1")
        XCTAssertEqual(projection.assistantID, "request-agent")
        XCTAssertEqual(projection.message, "Where should I save the report?")
        XCTAssertEqual(projection.options, [
            LocalInteractionOption(
                index: 0,
                label: "Team page",
                description: "Share it with the team."
            ),
            LocalInteractionOption(index: 3, label: "Private notes", description: nil),
        ])
        XCTAssertTrue(projection.allowsFreeText)
        XCTAssertEqual(projection.status, .pending)
        XCTAssertEqual(
            projection.expiresAt.timeIntervalSince1970,
            Date(timeIntervalSince1970: 1_785_668_400).timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testPreservesAnUnknownInteractionStatusWithoutMakingItActionable() throws {
        let projection = try JSONDecoder().decode(LocalInteraction.self, from: Data("""
        {
          "interaction_id": "interaction-1",
          "run_id": "run-1",
          "assistant_id": "request-agent",
          "message": "Wait for the server",
          "options": [],
          "allows_free_text": false,
          "expires_at": "2026-08-02T11:00:00Z",
          "status": "awaiting_policy"
        }
        """.utf8))

        XCTAssertEqual(projection.status, .unknown("awaiting_policy"))
        XCTAssertFalse(projection.status.canRespond)
    }

    func testEncodesTheExactIndexedOptionReplyEnvelope() throws {
        let encoded = try JSONEncoder().encode(
            LocalInteractionReply.option(index: 3)
        )

        XCTAssertEqual(
            try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? NSDictionary),
            ["response": ["type": "option", "optionIndex": 3]]
        )
    }

    func testEncodesTheExactFreeTextReplyEnvelope() throws {
        let encoded = try JSONEncoder().encode(
            LocalInteractionReply.text("Save it privately.")
        )

        XCTAssertEqual(
            try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? NSDictionary),
            ["response": ["type": "text", "text": "Save it privately."]]
        )
    }

    func testMapsTheAcceptedFollowUpRun() throws {
        let accepted = try JSONDecoder().decode(InteractionReplyAcceptance.self, from: Data("""
        {
          "interaction_id": "interaction-1",
          "run_id": "follow-up-run-1",
          "status": "accepted"
        }
        """.utf8))

        XCTAssertEqual(accepted.interactionID, "interaction-1")
        XCTAssertEqual(accepted.runID, "follow-up-run-1")
        XCTAssertEqual(accepted.status, .accepted)
    }
}
