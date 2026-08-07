import XCTest

@testable import AgentServerCore

final class AgentConnectionUseTests: XCTestCase {
    func testValidConnectionUseKeepsOnlyLogicalAgentIntent() {
        let use = AgentConnectionUse(
            key: "notion_work",
            serviceType: "notion",
            name: "Notion Work",
            purpose: "Read work notes and publish the daily focus page",
            operations: ["notion.search", "notion.page.read", "notion.page.create"],
            resources: [
                AgentConnectionResourceSlot(
                    key: "daily_focus_pages",
                    type: "notion.data-source",
                    purpose: "Store daily focus pages",
                    access: .readWrite
                ),
            ]
        )

        XCTAssertTrue(use.isValid)
        XCTAssertEqual(use.validationIssues, [])
        XCTAssertEqual(use.key, "notion_work")
        XCTAssertEqual(use.serviceType, "notion")
        XCTAssertEqual(use.operations, ["notion.search", "notion.page.read", "notion.page.create"])
        XCTAssertEqual(use.resources.first?.key, "daily_focus_pages")
    }

    func testConnectionUseReportsEveryInvalidEditableField() {
        let use = AgentConnectionUse(
            key: "Notion Work",
            serviceType: "",
            name: " \n ",
            purpose: "\t",
            operations: [],
            resources: []
        )

        XCTAssertEqual(
            use.validationIssues,
            [
                .invalidKey("Notion Work"),
                .serviceTypeRequired,
                .nameRequired,
                .purposeRequired,
                .operationRequired,
            ]
        )
    }

    func testOperationsAreSemanticNamesAndMustBeUnique() {
        let use = makeUse(operations: ["notion.search", "API-post-search", "notion.search"])

        XCTAssertEqual(
            use.validationIssues,
            [
                .invalidOperation("API-post-search"),
                .duplicateOperation("notion.search"),
            ]
        )
    }

    func testResourceSlotsUseLogicalKeysInsteadOfResourceIdentifiers() {
        let use = makeUse(resources: [
            AgentConnectionResourceSlot(
                key: "Daily Focus Pages",
                type: "",
                purpose: " ",
                access: .read
            ),
            AgentConnectionResourceSlot(
                key: "daily_focus_pages",
                type: "notion_data-source",
                purpose: "Read source notes",
                access: .read
            ),
            AgentConnectionResourceSlot(
                key: "daily_focus_pages",
                type: "notion_data-source",
                purpose: "Publish the report",
                access: .readWrite
            ),
        ])

        XCTAssertEqual(
            use.validationIssues,
            [
                .invalidResourceKey("Daily Focus Pages"),
                .resourceTypeRequired("Daily Focus Pages"),
                .resourcePurposeRequired("Daily Focus Pages"),
                .duplicateResourceKey("daily_focus_pages"),
            ]
        )
    }

    func testCollectionRequiresUniqueLogicalUseKeysAndNames() {
        let first = makeUse()
        let duplicateKey = makeUse(name: "Notion Personal")
        let duplicateName = makeUse(key: "notion_personal")

        XCTAssertEqual(
            AgentConnectionUseCollection.validationIssues(for: [first, duplicateKey, duplicateName]),
            [
                .duplicateUseKey("notion_work"),
                .duplicateUseName("Notion Work"),
            ]
        )
    }

    func testAccessValuesMatchTheNeutralConfigurationVocabulary() {
        XCTAssertEqual(AgentConnectionResourceAccess.read.rawValue, "read")
        XCTAssertEqual(AgentConnectionResourceAccess.write.rawValue, "write")
        XCTAssertEqual(AgentConnectionResourceAccess.readWrite.rawValue, "read_write")
    }

    func testOperationsMustBeQualifiedAndTypesAcceptSeparatedSegments() {
        let use = AgentConnectionUse(
            key: "work_notes",
            serviceType: "google.workspace-notes",
            name: "Work notes",
            purpose: "Read source notes",
            operations: ["search"],
            resources: [
                AgentConnectionResourceSlot(
                    key: "source_notes",
                    type: "workspace_notes.folder-type",
                    purpose: "Limit note searches",
                    access: .read
                ),
            ]
        )

        XCTAssertEqual(use.validationIssues, [.invalidOperation("search")])
    }

    func testLogicalKeysRejectHyphensAndValuesLongerThan64Characters() {
        XCTAssertEqual(
            makeUse(key: "notion-work").validationIssues,
            [.invalidKey("notion-work")]
        )
        let longKey = "a" + String(repeating: "b", count: 64)
        XCTAssertEqual(
            makeUse(key: longKey).validationIssues,
            [.invalidKey(longKey)]
        )
    }

    private func makeUse(
        key: String = "notion_work",
        name: String = "Notion Work",
        operations: [String] = ["notion.search"],
        resources: [AgentConnectionResourceSlot] = []
    ) -> AgentConnectionUse {
        AgentConnectionUse(
            key: key,
            serviceType: "notion",
            name: name,
            purpose: "Read work notes",
            operations: operations,
            resources: resources
        )
    }
}
