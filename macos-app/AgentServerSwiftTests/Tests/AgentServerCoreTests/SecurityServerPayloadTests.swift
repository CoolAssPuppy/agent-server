import XCTest
@testable import AgentServerCore

final class SecurityServerPayloadTests: XCTestCase {
    func testDecodesAgentSecurityAnalysisIntoConsumerFinding() throws {
        let payload = try JSONDecoder().decode(SecurityAnalysisPayload.self, from: Data(Self.analysisJSON.utf8))
        let presentation = payload.presentation

        XCTAssertEqual(payload.agentId, "weekly-summary")
        XCTAssertEqual(payload.contentHash, "sha256:" + String(repeating: "a", count: 64))
        XCTAssertEqual(presentation.overallRisk, .high)
        XCTAssertEqual(presentation.findings.first?.title, "External content can influence this agent")
        XCTAssertEqual(presentation.findings.first?.whyItMatters, "Issue text may contain misleading instructions.")
        XCTAssertEqual(presentation.findings.first?.recommendation, "Treat issue text as information, not instructions.")
        XCTAssertFalse(presentation.findings.first?.canFix ?? true)
    }

    func testDecodesGlobalScanAndBuildsNamedDashboard() throws {
        let scan = try JSONDecoder().decode(SecurityScanPayload.self, from: Data(Self.scanJSON.utf8))
        let dashboard = scan.presentation(agentNames: ["weekly-summary": "Friday summary"])

        XCTAssertEqual(scan.summary.totalAgents, 1)
        XCTAssertEqual(scan.summary.staleReviews, 1)
        XCTAssertEqual(dashboard.agents.first?.name, "Friday summary")
        XCTAssertEqual(dashboard.agents.first?.risk, .high)
        XCTAssertTrue(dashboard.agents.first?.isStale ?? false)
    }

    func testSecurityRoutesUseExpectedAuthenticatedMethodsAndEscapedIdentifiers() {
        XCTAssertEqual(SecurityServerRoute.agent("folder/reviewer").path, "/security/agents/folder%2Freviewer")
        XCTAssertEqual(SecurityServerRoute.agent("reviewer").method, .get)
        XCTAssertEqual(SecurityServerRoute.scan.path, "/security/scan")
        XCTAssertEqual(SecurityServerRoute.scan.method, .post)
        XCTAssertEqual(SecurityServerRoute.review("reviewer").path, "/security/agents/reviewer/review")
        XCTAssertEqual(SecurityServerRoute.review("reviewer").method, .post)
    }

    func testReviewRequestEncodesServerFieldNames() throws {
        let request = SecurityReviewRequestPayload(
            contentHash: "sha256:" + String(repeating: "b", count: 64),
            acknowledgedFindingIds: ["broad-files"]
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])

        XCTAssertNotNil(object["content_hash"])
        XCTAssertEqual(object["acknowledged_finding_ids"] as? [String], ["broad-files"])
    }

    func testAcknowledgementsAccumulateUntilAgentContentChanges() {
        var state = SecurityAcknowledgementState()
        state.acknowledge(agentId: "reader", contentHash: "hash-1", findingId: "one")
        state.acknowledge(agentId: "reader", contentHash: "hash-1", findingId: "two")

        XCTAssertEqual(state.findingIds(agentId: "reader", contentHash: "hash-1"), Set(["one", "two"]))
        XCTAssertEqual(state.findingIds(agentId: "reader", contentHash: "hash-2"), Set<String>())
    }

    private static let analysisJSON = """
    {
      "schema_version": 1,
      "agent_id": "weekly-summary",
      "content_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "analyzer_version": "1.0.0",
      "analyzed_at": "2026-07-18T09:00:00.000Z",
      "risk": { "level": "high", "reasons": ["External input"], "finding_count": 1 },
      "findings": [{
        "id": "prompt-injection",
        "rule_id": "prompt.untrusted-input",
        "severity": "high",
        "title": "External content can influence this agent",
        "explanation": "Issue text may contain misleading instructions.",
        "potential_impact": "The agent may send unintended content.",
        "trigger": "Untrusted input plus messaging",
        "evidence": [{ "code": "prompt", "label": "Instructions", "detail": "Value redacted", "source": "configuration" }],
        "recommendation": {
          "id": "constrain-input",
          "label": "Treat issue text as information, not instructions.",
          "description": "Adds an explicit untrusted-input constraint.",
          "kind": "manual",
          "risk": "low",
          "requires_confirmation": false,
          "affects_functionality": false
        },
        "can_ignore": true,
        "model_generated": false,
        "confidence": 0.94
      }],
      "is_stale": true,
      "model_status": "not_needed"
    }
    """

    private static let scanJSON = """
    {
      "analyses": [\(analysisJSON)],
      "summary": {
        "total_agents": 1,
        "by_risk": { "low": 0, "needs_review": 0, "high": 1, "critical": 0 },
        "stale_reviews": 1
      }
    }
    """
}
