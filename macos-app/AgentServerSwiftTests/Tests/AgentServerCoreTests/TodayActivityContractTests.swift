import Foundation
import XCTest

@testable import AgentServerCore

final class TodayActivityContractTests: XCTestCase {
    func testDecodesTheFrozenLocalFixtureAndAdaptsItsConsumerMeaning() throws {
        let fixtureData = try Self.fixtureData()
        let snapshot = try TodayActivitySnapshot.decode(from: fixtureData)
        let defaultDecodedSnapshot = try JSONDecoder().decode(
            TodayActivitySnapshot.self,
            from: fixtureData
        )
        XCTAssertEqual(defaultDecodedSnapshot, snapshot)

        let today = snapshot.makeTodayPresentation()
        XCTAssertEqual(
            today.sections.map(\.section),
            [.needsYou, .working, .finished, .problems, .upcoming]
        )

        let needsYou = try XCTUnwrap(today.sections.first?.items.first)
        XCTAssertEqual(needsYou.assistantID, "needs-agent")
        XCTAssertEqual(needsYou.assistantInstallationID, "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99:needs-agent")
        XCTAssertEqual(needsYou.headline, "Weekly Report needs your choice")
        XCTAssertEqual(needsYou.headlineStatement.evidenceReferences, ["interaction.request", "interaction.agentId"])
        XCTAssertEqual(needsYou.explanationStatement.evidenceReferences, ["interaction.request.message"])
        XCTAssertEqual(needsYou.date, Self.date("2026-08-02T09:30:00.000Z"))
        XCTAssertEqual(needsYou.expiresAt, Self.date("2026-08-02T10:30:00.000Z"))
        XCTAssertEqual(needsYou.primaryAction.kind, .respond)
        XCTAssertEqual(needsYou.primaryAction.label, "Choose")
        XCTAssertEqual(needsYou.primaryAction.targetReference, "interaction:interaction-1")
        XCTAssertEqual(needsYou.secondaryDisclosure?.kind, .viewActivity)
        XCTAssertEqual(needsYou.secondaryDisclosure?.targetReference, "run:needs-run")
        XCTAssertEqual(
            needsYou.sourceReferences,
            ["interaction.id", "interaction.runId", "interaction.request"]
        )

        let upcoming = try XCTUnwrap(today.sections.last?.items.first)
        XCTAssertEqual(upcoming.date, Self.date("2026-08-02T11:00:00.000Z"))

        let activity = snapshot.makeActivityPresentation(filter: .all)
        XCTAssertEqual(
            activity.items.map(\.id),
            ["run:needs-run", "run:working-run", "run:completed-run", "run:problem-run"]
        )
        let finished = try XCTUnwrap(activity.items.first(where: { $0.state == .finished }))
        XCTAssertEqual(finished.startedAt, Self.date("2026-08-02T08:00:00.000Z"))
        XCTAssertEqual(finished.endedAt, Self.date("2026-08-02T08:02:00.000Z"))
        XCTAssertEqual(finished.headlineStatement.evidenceReferences, ["run.status"])
        XCTAssertEqual(finished.outcomeSummaryStatement?.evidenceReferences, ["run.summary"])
        XCTAssertNil(finished.primaryOutputStatement)
        XCTAssertEqual(finished.reviewReference, "/runs/completed-run/review")
        XCTAssertEqual(finished.sourceReferences, ["run.runId", "run.status", "run.startedAt"])
    }

    func testUnknownKindsDoNotBlankTheSnapshot() throws {
        let snapshot = try TodayActivitySnapshot.decode(from: Data(Self.futureFixture.utf8))

        let today = snapshot.makeTodayPresentation()
        XCTAssertEqual(today.sections.flatMap(\.items).map(\.id), ["known-today"])
        XCTAssertEqual(today.sections.first?.items.first?.primaryAction.kind, .unknown)
        XCTAssertEqual(today.sections.first?.items.first?.primaryAction.targetReference, "future:target")

        let activity = snapshot.makeActivityPresentation(filter: .all)
        XCTAssertEqual(activity.items.map(\.id), ["known-activity"])
    }

    private static func fixtureData() throws -> Data {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = repositoryRoot
            .appendingPathComponent("docs/v2/fixtures/today-activity-local.json")
        return try Data(contentsOf: fixtureURL)
    }

    private static func date(_ value: String) -> Date {
        ISO8601DateFormatter.presentation.date(from: value)!
    }

    private static let futureFixture = """
    {
      "today": {
        "sections": [
          {
            "kind": "future_section",
            "items": [{
              "id": "unknown-today",
              "section": "future_section",
              "assistant": {
                "installationId": "machine-1:assistant-1",
                "machineId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
                "localAgentId": "assistant-1",
                "displayName": "Future assistant"
              },
              "headline": {"text": "Future update", "evidenceReferences": ["future.state"]},
              "explanation": {"text": "Future explanation", "evidenceReferences": ["future.state"]},
              "occurredAt": "2026-08-02T10:00:00.000Z",
              "primaryAction": {"kind": "future_action", "label": "Open", "targetReference": "future:unknown"},
              "sourceReferences": ["future.state"]
            }]
          },
          {
            "kind": "finished",
            "items": [{
              "id": "known-today",
              "section": "finished",
              "assistant": {
                "installationId": "machine-1:assistant-2",
                "machineId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
                "localAgentId": "assistant-2",
                "displayName": "Known assistant"
              },
              "headline": {"text": "Known update", "evidenceReferences": ["run.status"]},
              "explanation": {"text": "Known explanation", "evidenceReferences": ["run.status"]},
              "occurredAt": "2026-08-02T09:00:00.000Z",
              "primaryAction": {"kind": "future_action", "label": "Open", "targetReference": "future:target"},
              "sourceReferences": ["run.status"]
            }]
          }
        ]
      },
      "activity": {
        "items": [
          {
            "id": "unknown-activity",
            "assistant": {
              "installationId": "machine-1:assistant-1",
              "machineId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
              "localAgentId": "assistant-1",
              "displayName": "Future assistant"
            },
            "state": "future_state",
            "headline": {"text": "Future activity", "evidenceReferences": ["future.state"]},
            "startedAt": "2026-08-02T10:00:00.000Z",
            "reviewReference": "/runs/unknown-activity/review",
            "sourceReferences": ["future.state"]
          },
          {
            "id": "known-activity",
            "assistant": {
              "installationId": "machine-1:assistant-2",
              "machineId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
              "localAgentId": "assistant-2",
              "displayName": "Known assistant"
            },
            "state": "finished",
            "headline": {"text": "Known activity", "evidenceReferences": ["run.status"]},
            "startedAt": "2026-08-02T09:00:00.000Z",
            "reviewReference": "/runs/known-activity/review",
            "sourceReferences": ["run.status"]
          }
        ]
      }
    }
    """
}

private extension ISO8601DateFormatter {
    static let presentation: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
