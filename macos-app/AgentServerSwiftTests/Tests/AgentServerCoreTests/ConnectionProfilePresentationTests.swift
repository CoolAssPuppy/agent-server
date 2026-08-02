import XCTest
@testable import AgentServerCore

final class ConnectionProfilePresentationTests: XCTestCase {
    func testCredentialBackedProfileIsPresentedAsAPI() throws {
        let presentation = ConnectionProfilePresentation(
            profile: try makeProfile(),
            configuredEnvironmentVariables: ["ARCHIVE_TOKEN"]
        )

        XCTAssertEqual(presentation.category, .api)
    }
    func testSavedConnectionKeepsItsUserLabelAndShowsUsefulTechnicalDetails() throws {
        let profile = try makeProfile()

        let row = ConnectionProfilePresentation(profile: profile, configuredEnvironmentVariables: [])

        XCTAssertEqual(row.name, "My writing archive")
        XCTAssertEqual(row.connectionMethod, "Web service")
        XCTAssertEqual(row.location, "https://archive.example/mcp")
        XCTAssertEqual(row.credentialSummary, "1 credential")
        XCTAssertEqual(row.status, .needsCredentials)
        XCTAssertEqual(row.rowSummary, "Web service · Needs credentials")
        XCTAssertEqual(row.rowActionTitle, "Add credentials")
        XCTAssertEqual(row.statusTitle, "Needs credentials")
        XCTAssertEqual(
            row.statusExplanation,
            "Add the missing credential before an assistant can use this connection."
        )
    }


    func testSavedConnectionRowLeadsWithConsumerMethodAndReadiness() throws {
        let row = ConnectionProfilePresentation(
            profile: try makeProfile(),
            configuredEnvironmentVariables: ["ARCHIVE_TOKEN"]
        )

        XCTAssertEqual(row.rowSummary, "Web service · Ready")
        XCTAssertEqual(row.rowActionTitle, "View")
        XCTAssertEqual(row.technicalDetailsTitle, "Technical details")
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
        XCTAssertEqual(ready.statusTitle, "Ready")
        XCTAssertEqual(
            ready.statusExplanation,
            "Assistants can use this connection when you grant them access."
        )
    }

    func testConnectionDetailListsCredentialReferencesWithoutSecretValues() throws {
        let row = ConnectionProfilePresentation(
            profile: try makeProfile(),
            configuredEnvironmentVariables: ["ARCHIVE_TOKEN"]
        )

        XCTAssertEqual(row.credentialReferences, ["Access token · ARCHIVE_TOKEN"])
    }

    func testConnectionPanelSelectionCanBeSteppedBackWithoutClosingTheDrawer() {
        var navigation = ConnectionPanelNavigationState()

        XCTAssertFalse(navigation.stepBack())

        navigation.selectConnection("profile-1")
        XCTAssertEqual(navigation.selectedConnectionID, "profile-1")
        XCTAssertTrue(navigation.stepBack())
        XCTAssertNil(navigation.selectedConnectionID)
        XCTAssertFalse(navigation.stepBack())
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
