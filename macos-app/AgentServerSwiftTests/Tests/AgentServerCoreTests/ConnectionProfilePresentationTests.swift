import XCTest
@testable import AgentServerCore

final class ConnectionProfilePresentationTests: XCTestCase {
    func testSavedConnectionKeepsItsUserLabelAndShowsUsefulTechnicalDetails() throws {
        let profile = try makeProfile()

        let row = ConnectionProfilePresentation(profile: profile, configuredEnvironmentVariables: [])

        XCTAssertEqual(row.name, "My writing archive")
        XCTAssertEqual(row.connectionMethod, "Web service")
        XCTAssertEqual(row.location, "https://archive.example/mcp")
        XCTAssertEqual(row.credentialSummary, "1 credential")
        XCTAssertEqual(row.status, .needsCredentials)
    }

    func testConnectionIsReadyOnlyWhenEveryReferencedCredentialExists() throws {
        let profile = try makeProfile()

        let missing = ConnectionProfilePresentation(
            profile: profile,
            configuredEnvironmentVariables: ["UNRELATED_KEY"]
        )
        let ready = ConnectionProfilePresentation(
            profile: profile,
            configuredEnvironmentVariables: ["ARCHIVE_TOKEN"]
        )

        XCTAssertEqual(missing.status, .needsCredentials)
        XCTAssertEqual(ready.status, .ready)
    }

    private func makeProfile() throws -> ConnectionProfile {
        let payload = Data(#"""
        {
          "schema_version": 1,
          "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c21",
          "label": "My writing archive",
          "adapter": { "id": "mcp.custom", "version": 1 },
          "runtime_name": "connection_018f47a29a137d61bf4ff9a5d8f67c21",
          "credentials": [{
            "id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
            "label": "Access token",
            "environment_variable": "ARCHIVE_TOKEN",
            "secret": true
          }],
          "transport": {
            "kind": "mcp_http",
            "url": "https://archive.example/mcp",
            "headers": [{
              "name": "Authorization",
              "credential_id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
              "prefix": "Bearer "
            }]
          },
          "created_at": "2026-07-19T18:00:00.000Z",
          "updated_at": "2026-07-19T18:00:00.000Z"
        }
        """#.utf8)
        return try JSONDecoder().decode(ConnectionProfile.self, from: payload)
    }
}
