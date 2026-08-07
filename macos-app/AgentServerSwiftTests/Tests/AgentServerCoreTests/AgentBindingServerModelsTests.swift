import Foundation
import XCTest

@testable import AgentServerCore

final class AgentBindingServerModelsTests: XCTestCase {
    func testDecodesPortableUsesAndLocalBindingsSeparately() throws {
        let use = try JSONDecoder().decode(
            AgentConnectionUseServerModel.self,
            from: Data(#"{"type":"notion","name":"Notion Work","purpose":"Publish a report","operations":["notion.page.create"],"resources":{"report_database":{"type":"notion.data_source","purpose":"Report destination","access":"write"}}}"#.utf8)
        )
        XCTAssertEqual(use.name, "Notion Work")
        XCTAssertEqual(use.resources["report_database"]?.access, .write)

        let bindings = try JSONDecoder().decode(
            AgentBindingSetResponse.self,
            from: Data(#"{"revision":1,"connections":{"work_notes":{"connection_id":"018f47a2-9a13-7d61-bf4f-f9a5d8f67c21","resources":{"report_database":{"id":"data-source-1","operation_ids":{"notion.page.create":"database-1"}}}}}}"#.utf8)
        )
        XCTAssertEqual(bindings.connections["work_notes"]?.resources["report_database"]?.id, "data-source-1")
        XCTAssertEqual(
            bindings.connections["work_notes"]?.resources["report_database"]?.operationIDs["notion.page.create"],
            "database-1"
        )

        let skillBindings = try JSONDecoder().decode(
            AgentBindingSetResponse.self,
            from: Data(#"{"revision":1,"connections":{},"skills":{"editorial_diagnostic":{"path":"/shared/skills/fiction-diagnostic"}}}"#.utf8)
        )
        XCTAssertEqual(
            skillBindings.skills["editorial_diagnostic"]?.path,
            "/shared/skills/fiction-diagnostic"
        )
    }

    func testBindingWriteKeepsLocalIDsOutOfPortableUse() throws {
        let request = AgentBindingSetRequest(
            expectedRevision: 0,
            connections: [
                "work_notes": AgentConnectionBindingRequest(
                    connectionID: "018f47a2-9a13-7d61-bf4f-f9a5d8f67c21",
                    resources: ["report_database": AgentResourceBinding(id: "database-1")]
                ),
            ]
        )
        let text = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
        XCTAssertTrue(text.contains("connection_id"))
        XCTAssertTrue(text.contains("expected_revision"))
        XCTAssertTrue(text.contains("skills"))
        XCTAssertFalse(text.contains("Notion Work"))
    }
}
