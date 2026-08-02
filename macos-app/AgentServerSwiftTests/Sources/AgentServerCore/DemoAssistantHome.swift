import Foundation

enum DemoAssistantHome {
    static func ready() -> AssistantHomeContract {
        guard let contract = try? JSONDecoder().decode(
            AssistantHomeContract.self,
            from: Data(readyJSON.utf8)
        ) else {
            preconditionFailure("The deterministic Assistant home fixture must decode.")
        }
        return contract
    }

    private static let readyJSON = """
    {
      "generatedAt": "2026-08-02T10:00:00.000Z",
      "assistant": {
        "installationId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99:weekly-report",
        "machineId": "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
        "localAgentId": "weekly-report",
        "displayName": "Weekly Report"
      },
      "purpose": {
        "text": "Prepares a clear weekly report from your approved project notes.",
        "evidenceReferences": ["agent.description"]
      },
      "health": {
        "state": "healthy",
        "summary": {"text": "Healthy", "evidenceReferences": ["readiness.state"]},
        "reasonReferences": ["agent.enabled", "readiness.state"]
      },
      "readiness": {
        "state": "ready",
        "summary": {"text": "Everything required for the next run is available.", "evidenceReferences": ["readiness.checks"]},
        "checks": [
          {"kind":"server","state":"pass","explanation":{"text":"Agent Server is running on this Mac.","evidenceReferences":["server.health"]},"evidenceSource":"server.health"},
          {"kind":"engine","state":"pass","explanation":{"text":"Claude Code is installed and signed in.","evidenceReferences":["runtime.authentication"]},"evidenceSource":"runtime.authentication"},
          {"kind":"file","state":"pass","explanation":{"text":"Project notes and Reports are available.","evidenceReferences":["agent.file_access"]},"evidenceSource":"agent.file_access"},
          {"kind":"connection","state":"pass","explanation":{"text":"Personal Notion is ready.","evidenceReferences":["connection.status"]},"evidenceSource":"connection.status"}
        ]
      },
      "schedule": {
        "kind": "scheduled",
        "summary": {"text": "Runs every Monday at 9:00 AM.", "evidenceReferences": ["agent.schedule"]},
        "nextRunAt": "2026-08-03T09:00:00.000Z"
      },
      "permissions": [
        {"effect":"can","action":"read","targetLabel":"Project notes","exactScopeReference":"/Users/person/Documents/Project notes","sourceRuleReference":"agent.file_access[0]"},
        {"effect":"can","action":"edit","targetLabel":"Reports","exactScopeReference":"/Users/person/Documents/Reports","sourceRuleReference":"agent.file_access[1]"},
        {"effect":"cannot","action":"execute","targetLabel":"terminal commands","exactScopeReference":"/Users/person/Documents","sourceRuleReference":"agent.permissions.deny"}
      ],
      "connections": [{
        "id": "notion-personal",
        "label": "Personal Notion",
        "state": "ready",
        "explanation": {"text": "Connected and available on this Mac.", "evidenceReferences": ["connection.status"]}
      }],
      "destination": {
        "text": "Results go to the Reports folder and Personal Notion.",
        "evidenceReferences": ["agent.output.primary", "agent.connection_bindings"]
      },
      "recentOutcomes": [
        {"runId":"run-latest","outcome":"succeeded","headline":{"text":"Weekly report finished","evidenceReferences":["run.status"]},"occurredAt":"2026-08-02T09:05:00.000Z","reviewReference":"/runs/run-latest/review"},
        {"runId":"run-older","outcome":"succeeded","headline":{"text":"Previous report saved","evidenceReferences":["run.status"]},"occurredAt":"2026-07-26T09:04:00.000Z","reviewReference":"/runs/run-older/review"}
      ],
      "primaryAction": {"kind":"run","label":"Run now","targetReference":"assistant:weekly-report"},
      "secondaryActions": [
        {"kind":"pause","label":"Pause","targetReference":"assistant:weekly-report"},
        {"kind":"edit","label":"Edit","targetReference":"assistant:weekly-report"}
      ],
      "advancedReference": "/agents/weekly-report"
    }
    """
}
