import XCTest
@testable import AgentServerCore

final class ConnectionProfileServerModelsTests: XCTestCase {
    func testDecodesAListOfRemoteConnectionProfilesWithoutCredentialValues() throws {
        let payload = Data(#"""
        {
          "connections": [{
            "schema_version": 1,
            "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c21",
            "label": "Production reports",
            "adapter": { "id": "mcp.custom", "version": 1 },
            "runtime_name": "connection_018f47a29a137d61bf4ff9a5d8f67c21",
            "credentials": [{
              "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
              "label": "API key",
              "environment_variable": "REPORTS_API_KEY",
              "secret": true
            }],
            "transport": {
              "kind": "mcp_http",
              "url": "https://reports.example/mcp",
              "headers": [{
                "name": "Authorization",
                "credential_id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
                "prefix": "Bearer "
              }]
            },
            "created_at": "2026-07-19T18:00:00.000Z",
            "updated_at": "2026-07-19T18:00:00.000Z"
          }]
        }
        """#.utf8)

        let response = try JSONDecoder().decode(ConnectionProfileListResponse.self, from: payload)
        let profile = try XCTUnwrap(response.connections.first)

        XCTAssertEqual(profile.label, "Production reports")
        XCTAssertEqual(profile.credentials.map(\.environmentVariable), ["REPORTS_API_KEY"])
        XCTAssertEqual(profile.transport, .http(
            url: "https://reports.example/mcp",
            headers: [ConnectionCredentialHeader(
                name: "Authorization",
                credentialID: "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
                prefix: "Bearer "
            )]
        ))
        XCTAssertFalse(String(decoding: payload, as: UTF8.self).contains("secret-value"))
    }

    func testDecodesAConnectionThatStartsAnAppOnThisMac() throws {
        let payload = Data(#"""
        {
          "schema_version": 1,
          "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c21",
          "label": "Local helper",
          "adapter": { "id": "mcp.custom", "version": 1 },
          "runtime_name": "connection_018f47a29a137d61bf4ff9a5d8f67c21",
          "credentials": [{
            "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
            "label": "Token",
            "environment_variable": "HELPER_TOKEN",
            "secret": true
          }],
          "transport": {
            "kind": "mcp_stdio",
            "command": "/Applications/Helper.app/Contents/MacOS/helper",
            "args": ["serve"],
            "environment": { "TOKEN": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22" }
          },
          "created_at": "2026-07-19T18:00:00.000Z",
          "updated_at": "2026-07-19T18:00:00.000Z"
        }
        """#.utf8)

        let profile = try JSONDecoder().decode(ConnectionProfile.self, from: payload)

        XCTAssertEqual(profile.transport, .stdio(
            command: "/Applications/Helper.app/Contents/MacOS/helper",
            arguments: ["serve"],
            environment: ["TOKEN": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22"]
        ))
    }

    func testEncodesTheCreateBoundaryWithoutCredentialValues() throws {
        let request = try ConnectionSetupDraft.web(
            label: "Private reports",
            url: "https://reports.example/mcp",
            credentials: [ConnectionCredentialDraft(
                label: "Token",
                environmentVariable: "REPORTS_TOKEN",
                value: "must-stay-on-this-mac"
            )]
        ).makeRequest()

        let body = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)

        XCTAssertTrue(body.contains("REPORTS_TOKEN"))
        XCTAssertFalse(body.contains("must-stay-on-this-mac"))
    }

    func testDecodesAReadinessCheckWithoutCredentialValues() throws {
        let payload = Data(#"""
        {
          "status": "needs_credentials",
          "missing_credentials": ["REPORTS_TOKEN"]
        }
        """#.utf8)

        let response = try JSONDecoder().decode(ConnectionReadinessResponse.self, from: payload)
        let presentation = ConnectionReadinessPresentation(response: response)

        XCTAssertEqual(response.status, .needsCredentials)
        XCTAssertEqual(response.missingCredentials, ["REPORTS_TOKEN"])
        XCTAssertEqual(presentation.title, "Needs credentials")
        XCTAssertEqual(
            presentation.explanation,
            "Add REPORTS_TOKEN before an agent uses this connection."
        )
        XCTAssertFalse(String(decoding: payload, as: UTF8.self).contains("must-not-leak"))
    }

    func testReadyConnectionExplainsTheScopeOfTheLocalCheck() {
        let presentation = ConnectionReadinessPresentation(
            response: ConnectionReadinessResponse(status: .ready, missingCredentials: [])
        )

        XCTAssertEqual(presentation.title, "Ready to use")
        XCTAssertTrue(presentation.isReady)
        XCTAssertEqual(
            presentation.explanation,
            "The required credentials are available. The service itself will be checked when an agent uses it."
        )
    }

    func testDecodesAgentsThatPreventConnectionRemoval() throws {
        let payload = Data(#"""
        {
          "error": "This connection is still used by 2 agents.",
          "code": "connection_in_use",
          "agents": [
            { "id": "daily-brief", "name": "Daily brief" },
            { "id": "weekly-review", "name": "Weekly review" }
          ]
        }
        """#.utf8)

        let conflict = try JSONDecoder().decode(ConnectionRemovalConflict.self, from: payload)

        XCTAssertEqual(conflict.agents.map(\.name), ["Daily brief", "Weekly review"])
        XCTAssertEqual(
            conflict.consumerExplanation,
            "Remove this connection from Daily brief and Weekly review before deleting it."
        )
    }

    func testDuplicateConnectionGetsARecognizableEditableName() {
        XCTAssertEqual(ConnectionCopyName.suggested(from: "Personal Notion"), "Personal Notion copy")
        XCTAssertEqual(
            ConnectionCopyName.suggested(from: String(repeating: "a", count: 120)).count,
            120
        )
    }
}
