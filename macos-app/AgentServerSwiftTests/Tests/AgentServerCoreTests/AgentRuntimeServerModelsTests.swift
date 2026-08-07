import Foundation
import XCTest

@testable import AgentServerCore

final class AgentRuntimeServerModelsTests: XCTestCase {
    func testDecodesSavedRuntimeAndCompatibilityIssues() throws {
        let runtime = try JSONDecoder().decode(
            AgentRuntimeAssignmentResponse.self,
            from: Data(#"{"source":"saved_assignment","agent_id":"daily-focus","executor":"codex","model":"gpt-5.3-codex","revision":2,"updated_at":"2026-08-06T12:00:00.000Z"}"#.utf8)
        )
        XCTAssertEqual(runtime.source, .savedAssignment)
        XCTAssertEqual(runtime.executor, "codex")
        XCTAssertEqual(runtime.revision, 2)

        let compatibility = try JSONDecoder().decode(
            AgentRuntimeCompatibility.self,
            from: Data(#"{"state":"needs_connection","issues":[{"code":"missing_connection","message":"Choose Notion Work.","use":"work_notes"}]}"#.utf8)
        )
        XCTAssertEqual(compatibility.state, .needsConnection)
        XCTAssertEqual(compatibility.issues.first?.use, "work_notes")
    }

    func testEncodesRuntimeWriteWithRevision() throws {
        let request = AgentRuntimeAssignmentRequest(
            executor: "kimi-code",
            model: nil,
            provider: nil,
            expectedRevision: 3
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(object["executor"] as? String, "kimi-code")
        XCTAssertEqual(object["expected_revision"] as? Int, 3)
        XCTAssertNil(object["model"])
    }
}
