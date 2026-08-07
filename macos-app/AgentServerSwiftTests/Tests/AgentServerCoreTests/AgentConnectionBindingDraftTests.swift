import XCTest

@testable import AgentServerCore

final class AgentConnectionBindingDraftTests: XCTestCase {
    func testBuildsRevisionCheckedRequestFromLogicalSlots() {
        let uses = [
            "work_notes": AgentConnectionUseServerModel(
                type: "notion",
                name: "Notion Work",
                purpose: "Publish reports",
                operations: ["notion.page.create"],
                resources: [
                    "reports": AgentConnectionResourceServerModel(
                        type: "notion.data_source",
                        purpose: "Report destination",
                        access: .write
                    ),
                ]
            ),
        ]
        var draft = AgentConnectionBindingDraft(
            uses: uses,
            bindingSet: AgentBindingSetResponse(revision: 4, connections: [:])
        )

        XCTAssertFalse(draft.isComplete)
        draft.setConnectionID("connection-1", for: "work_notes")
        draft.setResourceID("database-1", resource: "reports", use: "work_notes")

        XCTAssertTrue(draft.isComplete)
        XCTAssertEqual(draft.request.expectedRevision, 4)
        XCTAssertEqual(
            draft.request.connections["work_notes"]?.resources["reports"]?.id,
            "database-1"
        )
    }

    func testPreservesExistingLocalBindings() {
        let uses = [
            "work_notes": AgentConnectionUseServerModel(
                type: "notion",
                name: "Notion Work",
                purpose: "Read notes",
                operations: ["notion.page.read"],
                resources: [:]
            ),
        ]
        let bindings = AgentBindingSetResponse(
            revision: 2,
            connections: [
                "work_notes": AgentConnectionBindingRequest(
                    connectionID: "connection-2",
                    resources: [:]
                ),
            ]
        )

        let draft = AgentConnectionBindingDraft(uses: uses, bindingSet: bindings)

        XCTAssertTrue(draft.isComplete)
        XCTAssertEqual(draft.connectionID(for: "work_notes"), "connection-2")
    }

    func testPreservesOperationSpecificResourceIDsWhenSavingSettings() {
        let uses = [
            "personal_notes": AgentConnectionUseServerModel(
                type: "notion",
                name: "Notion Personal",
                purpose: "Read and publish reports",
                operations: ["notion.data_source.query", "notion.page.create"],
                resources: [
                    "reports": AgentConnectionResourceServerModel(
                        type: "notion.data_source",
                        purpose: "Reports",
                        access: .readWrite
                    ),
                ]
            ),
        ]
        let bindings = AgentBindingSetResponse(
            revision: 1,
            connections: [
                "personal_notes": AgentConnectionBindingRequest(
                    connectionID: "connection-1",
                    resources: [
                        "reports": AgentResourceBinding(
                            id: "data-source-1",
                            operationIDs: ["notion.page.create": "database-1"]
                        ),
                    ]
                ),
            ]
        )

        let draft = AgentConnectionBindingDraft(uses: uses, bindingSet: bindings)

        XCTAssertEqual(
            draft.request.connections["personal_notes"]?.resources["reports"]?.operationIDs,
            ["notion.page.create": "database-1"]
        )
    }

    func testRequiresAndSavesLocalSkillPaths() {
        let requirements = [
            "editorial_diagnostic": AgentSkillRequirementServerModel(
                name: "Fiction manuscript diagnostic",
                purpose: "Diagnose manuscript changes."
            ),
        ]
        var draft = AgentConnectionBindingDraft(
            uses: [:],
            skillRequirements: requirements,
            bindingSet: AgentBindingSetResponse(revision: 1, connections: [:])
        )

        XCTAssertFalse(draft.isComplete)
        draft.setSkillPath(
            "/shared/skills/fiction-diagnostic",
            for: "editorial_diagnostic"
        )

        XCTAssertTrue(draft.isComplete)
        XCTAssertEqual(
            draft.request.skills["editorial_diagnostic"]?.path,
            "/shared/skills/fiction-diagnostic"
        )
    }
}
