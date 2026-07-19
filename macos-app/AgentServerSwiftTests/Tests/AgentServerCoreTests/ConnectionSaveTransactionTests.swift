import XCTest
@testable import AgentServerCore

final class ConnectionSaveTransactionTests: XCTestCase {
    func testFailedProfileSaveRestoresThePreviousCredentialFile() async {
        let events = EventRecorder()

        do {
            _ = try await ConnectionSaveTransaction.run(
                saveCredentials: { await events.record("save credentials") },
                saveProfile: {
                    await events.record("save profile")
                    throw TestFailure.expected
                },
                restoreCredentials: { await events.record("restore credentials") }
            )
            XCTFail("Expected the profile save to fail")
        } catch {
            XCTAssertEqual(error as? TestFailure, .expected)
        }

        let failedEvents = await events.values
        XCTAssertEqual(failedEvents, [
            "save credentials",
            "save profile",
            "restore credentials",
        ])
    }

    func testSuccessfulProfileSaveKeepsTheNewCredentials() async throws {
        let events = EventRecorder()

        let profileID = try await ConnectionSaveTransaction.run(
            saveCredentials: { await events.record("save credentials") },
            saveProfile: {
                await events.record("save profile")
                return "profile-id"
            },
            restoreCredentials: { await events.record("restore credentials") }
        )

        XCTAssertEqual(profileID, "profile-id")
        let successfulEvents = await events.values
        XCTAssertEqual(successfulEvents, ["save credentials", "save profile"])
    }
}

private actor EventRecorder {
    private(set) var values: [String] = []
    func record(_ value: String) { values.append(value) }
}

private enum TestFailure: Error {
    case expected
}
