import XCTest
@testable import AgentServerCore

final class ConnectionOperationMappingTests: XCTestCase {
    func testDecodesCheckedInventoryAndReviewedMappingsWithoutCredentialContent() throws {
        let response = try JSONDecoder().decode(
            ConnectionOperationReviewResponse.self,
            from: Data(#"""
            {
              "status":"current",
              "capability_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "captured_at":"2026-08-06T13:00:00.000Z",
              "mapping_revision":2,
              "mapping_capability_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "operations":{"documents.list":{"runtime_name":"list_documents","effect":"read","target":{"argument":"database_id","resource_type":"documents.database"}}},
              "inventory":[{"id":"mcp:list_documents","runtime_name":"list_documents","effects":["read"],"classification":"curated","input_fields":["database_id"]}]
            }
            """#.utf8)
        )

        XCTAssertEqual(response.status, .current)
        XCTAssertEqual(response.mappingRevision, 2)
        XCTAssertEqual(response.inventory.first?.inputFields, ["database_id"])
        XCTAssertEqual(response.operations["documents.list"]?.target?.resourceType, "documents.database")
    }

    func testDraftBuildsVersionCheckedMappingsFromReviewedRows() throws {
        let response = ConnectionOperationReviewResponse(
            status: .unmapped,
            capabilityVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capturedAt: "2026-08-06T13:00:00.000Z",
            mappingRevision: 0,
            mappingCapabilityVersion: nil,
            operations: [:],
            inventory: [ConnectionCapabilityOperation(
                id: "mcp:create_document",
                runtimeName: "create_document",
                effects: ["unknown"],
                classification: "unknown",
                inputFields: ["database_id", "title"]
            )]
        )
        var draft = try ConnectionOperationMappingDraft(response: response)
        draft.rows[0].semanticOperation = "documents.create"
        draft.rows[0].targetArgument = "database_id"
        draft.rows[0].resourceType = "documents.database"

        let request = try draft.makeRequest()

        XCTAssertEqual(request.expectedRevision, 0)
        XCTAssertEqual(request.operations["documents.create"], ConnectionOperationMappingInput(
            runtimeName: "create_document",
            effect: "write",
            target: ConnectionOperationTarget(argument: "database_id", resourceType: "documents.database")
        ))
    }

    func testDraftRejectsAnIncompleteResourceTarget() throws {
        let response = ConnectionOperationReviewResponse(
            status: .unmapped,
            capabilityVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capturedAt: nil,
            mappingRevision: 0,
            mappingCapabilityVersion: nil,
            operations: [:],
            inventory: [ConnectionCapabilityOperation(
                id: "mcp:list_documents", runtimeName: "list_documents",
                effects: ["unknown"], classification: "unknown", inputFields: ["database_id"]
            )]
        )
        var draft = try ConnectionOperationMappingDraft(response: response)
        draft.rows[0].semanticOperation = "documents.list"
        draft.rows[0].targetArgument = "database_id"

        XCTAssertThrowsError(try draft.makeRequest()) { error in
            XCTAssertEqual(error as? ConnectionOperationMappingError, .incompleteTarget("list_documents"))
        }
    }
}
