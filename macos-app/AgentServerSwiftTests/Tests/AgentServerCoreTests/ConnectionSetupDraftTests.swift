import XCTest
@testable import AgentServerCore

final class ConnectionSetupDraftTests: XCTestCase {
    func testArbitraryLabelDoesNotBecomeAdapterOrRuntimeIdentity() throws {
        let draft = ConnectionSetupDraft.web(
            label: "Whatever I want to call this",
            url: "https://service.example/mcp"
        )

        let request = try draft.makeRequest()

        XCTAssertEqual(request.label, "Whatever I want to call this")
        XCTAssertEqual(request.adapter.id, "mcp.custom")
        XCTAssertNil(request.runtimeName)
    }

    func testSeveralCredentialsStayGroupedInOneConnection() throws {
        let draft = ConnectionSetupDraft.web(
            label: "Production",
            url: "https://service.example/mcp",
            credentials: [
                ConnectionCredentialDraft(
                    label: "API key",
                    environmentVariable: "SERVICE_API_KEY",
                    value: "first-secret"
                ),
                ConnectionCredentialDraft(
                    label: "Signing secret",
                    environmentVariable: "SERVICE_SIGNING_SECRET",
                    value: "second-secret"
                ),
            ]
        )

        let request = try draft.makeRequest()

        XCTAssertEqual(request.credentials.map(\.environmentVariable), [
            "SERVICE_API_KEY",
            "SERVICE_SIGNING_SECRET",
        ])
        XCTAssertEqual(draft.environmentValues, [
            "SERVICE_API_KEY": "first-secret",
            "SERVICE_SIGNING_SECRET": "second-secret",
        ])
    }

    func testEncodedProfileRequestNeverContainsCredentialValues() throws {
        let draft = ConnectionSetupDraft.web(
            label: "Private service",
            url: "https://service.example/mcp",
            credentials: [ConnectionCredentialDraft(
                label: "Token",
                environmentVariable: "PRIVATE_TOKEN",
                value: "must-not-leave-the-app"
            )]
        )

        let encoded = try JSONEncoder().encode(draft.makeRequest())
        let text = try XCTUnwrap(String(data: encoded, encoding: .utf8))

        XCTAssertTrue(text.contains("PRIVATE_TOKEN"))
        XCTAssertFalse(text.contains("must-not-leave-the-app"))
    }

    func testChangingLabelDoesNotInvalidateAConnectionTest() throws {
        var draft = ConnectionSetupDraft.web(
            label: "Initial label",
            url: "https://service.example/mcp"
        )
        draft.markTested()

        draft.label = "Renamed by the user"

        XCTAssertTrue(draft.isTestCurrent)
    }

    func testChangingTransportInvalidatesAConnectionTest() throws {
        var draft = ConnectionSetupDraft.web(
            label: "Service",
            url: "https://service.example/mcp"
        )
        draft.markTested()

        draft.webURL = "https://other.example/mcp"

        XCTAssertFalse(draft.isTestCurrent)
    }

    func testDuplicateEnvironmentVariableReferencesAreRejected() {
        let draft = ConnectionSetupDraft.web(
            label: "Service",
            url: "https://service.example/mcp",
            credentials: [
                ConnectionCredentialDraft(label: "First", environmentVariable: "SERVICE_TOKEN"),
                ConnectionCredentialDraft(label: "Second", environmentVariable: "SERVICE_TOKEN"),
            ]
        )

        XCTAssertThrowsError(try draft.makeRequest()) { error in
            XCTAssertEqual(error as? ConnectionSetupError, .duplicateEnvironmentVariable("SERVICE_TOKEN"))
        }
    }

    func testDuplicateLocalProcessVariablesAreRejected() {
        let credentials = [
            ConnectionCredentialDraft(
                label: "First",
                environmentVariable: "FIRST_TOKEN",
                targetName: "API_TOKEN"
            ),
            ConnectionCredentialDraft(
                label: "Second",
                environmentVariable: "SECOND_TOKEN",
                targetName: "API_TOKEN"
            ),
        ]
        let draft = ConnectionSetupDraft.local(
            label: "Local service",
            command: "npx",
            arguments: ["-y", "some-mcp-server"],
            credentials: credentials
        )

        XCTAssertThrowsError(try draft.makeRequest()) { error in
            XCTAssertEqual(error as? ConnectionSetupError, .duplicateTargetName("API_TOKEN"))
        }
    }
}
