import Foundation
import XCTest

@testable import AgentServerCore

final class AssistantHomeContractTests: XCTestCase {
    func testDecodesTheEvidenceBackedAssistantHomeContract() throws {
        let home = try Self.makeReadyHome()

        XCTAssertEqual(home.assistant.localAgentId, "weekly-report")
        XCTAssertEqual(home.purpose.text, "Prepares the weekly report from local notes.")
        XCTAssertEqual(home.health.state, .healthy)
        XCTAssertEqual(home.health.reasonReferences, ["agent.enabled", "readiness.state"])
        XCTAssertEqual(home.readiness.state, .ready)
        XCTAssertEqual(home.readiness.checks.map(\.state), [.pass, .pass])
        XCTAssertEqual(home.schedule.kind, .scheduled)
        XCTAssertEqual(home.schedule.nextRunAt, Self.date("2026-08-03T09:00:00.000Z"))
        XCTAssertEqual(home.permissions.first?.effect, .can)
        XCTAssertEqual(home.permissions.first?.action, .edit)
        XCTAssertEqual(home.connections.first?.state, .ready)
        XCTAssertEqual(home.destination?.text, "Results go to Updated weekly report.")
        XCTAssertEqual(home.recentOutcomes.first?.outcome, .succeeded)
        XCTAssertEqual(home.recentOutcomes.first?.occurredAt, Self.date("2026-08-02T09:05:00.000Z"))
        XCTAssertEqual(home.primaryAction.kind, .run)
        XCTAssertEqual(home.secondaryActions.map(\.kind), [.safeTest, .pause, .edit])
        XCTAssertEqual(home.advanced?.scheduleExpression, "0 9 * * 1")
        XCTAssertEqual(home.advanced?.executor, "codex")
        XCTAssertEqual(home.advanced?.model, "gpt-5.6-codex")
        XCTAssertEqual(home.advanced?.permissionMode, "plan")
        XCTAssertEqual(home.advanced?.permissionRules.allow, ["Read", "mcp__notion__search"])
        XCTAssertEqual(home.advanced?.permissionRules.deny, ["Bash"])
        XCTAssertEqual(home.advanced?.connectionIds, ["notion-personal"])
    }

    func testFutureStatesAndActionsRemainUnknownAndNeverDecodeAsReady() throws {
        let home = try JSONDecoder().decode(
            AssistantHomeContract.self,
            from: Data(Self.futureFixture.utf8)
        )

        XCTAssertEqual(home.health.state, .unknown("future_health"))
        XCTAssertEqual(home.readiness.state, .unknown("future_readiness"))
        XCTAssertEqual(home.readiness.checks.first?.kind, .unknown("future_check"))
        XCTAssertEqual(home.readiness.checks.first?.state, .unknown("future_state"))
        XCTAssertEqual(home.schedule.kind, .unknown("future_schedule"))
        XCTAssertEqual(home.connections.first?.state, .unknown("future_connection"))
        XCTAssertEqual(home.permissions.first?.effect, .unknown("future_effect"))
        XCTAssertEqual(home.permissions.first?.action, .unknown("future_action"))
        XCTAssertEqual(home.recentOutcomes.first?.outcome, .unknown("future_outcome"))
        XCTAssertEqual(home.primaryAction.kind, .unknown)
    }

    func testDecodesTheFrozenServerPresentationFixtureWithoutEndpointMetadata() throws {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repositoryRoot
            .appendingPathComponent("docs/v2/fixtures/assistant-home-local.json"))

        let home = try JSONDecoder().decode(AssistantHomeContract.self, from: data)

        XCTAssertNil(home.generatedAt)
        XCTAssertEqual(home.assistant.localAgentId, "weekly-report")
        XCTAssertEqual(home.primaryAction.kind, .resolveAttention)
        XCTAssertEqual(home.readiness.state, .needsSetup)
        XCTAssertEqual(home.advanced?.connectionIds, ["reports"])
    }

    private static func date(_ value: String) -> Date {
        ISO8601DateFormatter.assistantHome.date(from: value)!
    }

    static func makeReadyHome() throws -> AssistantHomeContract {
        try JSONDecoder().decode(
            AssistantHomeContract.self,
            from: Data(readyFixture.utf8)
        )
    }

    static func makeFutureHome() throws -> AssistantHomeContract {
        try JSONDecoder().decode(
            AssistantHomeContract.self,
            from: Data(futureFixture.utf8)
        )
    }

    static func makeDeferredHome() throws -> AssistantHomeContract {
        try JSONDecoder().decode(
            AssistantHomeContract.self,
            from: Data(deferredFixture.utf8)
        )
    }

    private static let readyFixture = """
    {
      "generatedAt": "2026-08-02T10:00:00.000Z",
      "assistant": {
        "installationId": "machine-1:weekly-report",
        "machineId": "machine-1",
        "localAgentId": "weekly-report",
        "displayName": "Weekly Report"
      },
      "purpose": {
        "text": "Prepares the weekly report from local notes.",
        "evidenceReferences": ["agent.description"]
      },
      "health": {
        "state": "healthy",
        "summary": {"text": "Healthy", "evidenceReferences": ["readiness.state"]},
        "reasonReferences": ["agent.enabled", "readiness.state"]
      },
      "readiness": {
        "state": "ready",
        "summary": {"text": "Ready to run.", "evidenceReferences": ["readiness.checks"]},
        "checks": [
          {
            "kind": "engine",
            "state": "pass",
            "explanation": {"text": "Claude Code is installed and signed in.", "evidenceReferences": ["runtime.executable"]},
            "evidenceSource": "runtime.executable"
          },
          {
            "kind": "file",
            "state": "pass",
            "explanation": {"text": "Reports is available.", "evidenceReferences": ["filesystem.stat"]},
            "evidenceSource": "filesystem.stat"
          }
        ]
      },
      "schedule": {
        "kind": "scheduled",
        "summary": {"text": "Runs every Monday at 9:00 AM.", "evidenceReferences": ["agent.schedule"]},
        "nextRunAt": "2026-08-03T09:00:00.000Z"
      },
      "permissions": [{
        "effect": "can",
        "action": "edit",
        "targetLabel": "Reports",
        "exactScopeReference": "/Users/person/Documents/Reports",
        "sourceRuleReference": "agent.file_access[0]"
      }],
      "connections": [{
        "id": "notion-personal",
        "label": "Personal Notion",
        "state": "ready",
        "explanation": {"text": "Connected on this Mac.", "evidenceReferences": ["connection.status"]}
      }],
      "destination": {
        "text": "Results go to Updated weekly report.",
        "evidenceReferences": ["agent.output.primary"]
      },
      "recentOutcomes": [{
        "runId": "run-7",
        "outcome": "succeeded",
        "headline": {"text": "Weekly report finished", "evidenceReferences": ["run.status"]},
        "occurredAt": "2026-08-02T09:05:00.000Z",
        "reviewReference": "/runs/run-7/review"
      }],
      "primaryAction": {"kind": "run", "label": "Run now", "targetReference": "assistant:weekly-report"},
      "secondaryActions": [
        {"kind": "safe_test", "label": "Safe test", "targetReference": "assistant:weekly-report"},
        {"kind": "pause", "label": "Pause", "targetReference": "assistant:weekly-report"},
        {"kind": "edit", "label": "Edit", "targetReference": "assistant:weekly-report"}
      ],
      "advanced": {
        "scheduleExpression": "0 9 * * 1",
        "executor": "codex",
        "model": "gpt-5.6-codex",
        "permissionMode": "plan",
        "permissionRules": {
          "allow": ["Read", "mcp__notion__search"],
          "deny": ["Bash"]
        },
        "connectionIds": ["notion-personal"]
      },
      "advancedReference": "/agents/weekly-report"
    }
    """

    private static let deferredFixture = """
    {
      "assistant": {"installationId":"m:a","machineId":"m","localAgentId":"a","displayName":"Daily Focus"},
      "purpose": {"text":"Writes the daily focus note.","evidenceReferences":["agent.description"]},
      "health": {
        "state":"healthy",
        "summary":{"text":"Ready and available.","evidenceReferences":["readiness.state"]},
        "reasonReferences":["agent.enabled","readiness.state"]
      },
      "readiness": {
        "state":"ready",
        "summary":{"text":"Ready to run.","evidenceReferences":["readiness.checks"]},
        "checks":[
          {
            "kind":"engine",
            "state":"unknown",
            "explanation":{"text":"AI engine sign-in will be checked when this agent runs.","evidenceReferences":["runtime.authentication"]},
            "evidenceSource":"runtime.authentication"
          },
          {
            "kind":"schedule",
            "state":"pass",
            "explanation":{"text":"The automatic schedule is valid.","evidenceReferences":["agent.schedule"]},
            "evidenceSource":"agent.schedule"
          }
        ]
      },
      "schedule":{"kind":"scheduled","summary":{"text":"Runs every day at 7:00 AM.","evidenceReferences":["agent.schedule"]}},
      "permissions":[],
      "connections":[],
      "recentOutcomes":[],
      "primaryAction":{"kind":"run","label":"Run now","targetReference":"assistant:a"},
      "secondaryActions":[],
      "advancedReference":"/agents/a"
    }
    """

    private static let futureFixture = """
    {
      "generatedAt": "2026-08-02T10:00:00Z",
      "assistant": {"installationId":"m:a","machineId":"m","localAgentId":"a","displayName":"Future"},
      "purpose": {"text":"Future purpose","evidenceReferences":["future"]},
      "health": {"state":"future_health","summary":{"text":"Future","evidenceReferences":["future"]},"reasonReferences":["future"]},
      "readiness": {
        "state":"future_readiness",
        "summary":{"text":"Future","evidenceReferences":["future"]},
        "checks":[{"kind":"future_check","state":"future_state","explanation":{"text":"Future","evidenceReferences":["future"]},"evidenceSource":"future"}]
      },
      "schedule":{"kind":"future_schedule","summary":{"text":"Future","evidenceReferences":["future"]}},
      "permissions":[{"effect":"future_effect","action":"future_action","targetLabel":"Future","exactScopeReference":"future","sourceRuleReference":"future"}],
      "connections":[{"id":"future","label":"Future","state":"future_connection","explanation":{"text":"Future","evidenceReferences":["future"]}}],
      "recentOutcomes":[{"runId":"future","outcome":"future_outcome","headline":{"text":"Future","evidenceReferences":["future"]},"occurredAt":"2026-08-02T09:00:00Z","reviewReference":"/runs/future/review"}],
      "primaryAction":{"kind":"future_action","label":"Future","targetReference":"future"},
      "secondaryActions":[],
      "advancedReference":"/agents/a"
    }
    """
}

private extension ISO8601DateFormatter {
    static let assistantHome: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
