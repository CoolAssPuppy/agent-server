import XCTest
@testable import AgentServerCore

final class ConnectionCredentialsPresentationTests: XCTestCase {
    func testNamedConfiguredAccountCanModifyItsExactKeys() {
        let section = ConnectionCredentialsPresentation(
            catalog: [catalogService(id: "notion", name: "Notion", keys: ["NOTION_API_KEY"])],
            connections: [connection(
                id: "mcp:notion-personal:one",
                serviceId: "notion",
                name: "Personal Notion",
                status: "connected",
                keys: ["NOTION_PERSONAL_API_KEY"]
            )]
        )

        XCTAssertEqual(section.rows.first, ConnectionCredentialRow(
            id: "mcp:notion-personal:one",
            serviceId: "notion",
            name: "Personal Notion",
            status: .connected,
            action: .modifyKeys,
            requiredEnvironmentKeys: ["NOTION_PERSONAL_API_KEY"]
        ))
        XCTAssertEqual(section.rows.last?.action, .addAnother)
        XCTAssertEqual(section.rows.last?.action.title, "Add another")
    }

    func testServiceWithoutConfiguredAccountOffersAddKeys() {
        let section = ConnectionCredentialsPresentation(
            catalog: [catalogService(id: "tripmaster", name: "TripMaster", keys: ["TRIPMASTER_API_KEY"])],
            connections: []
        )

        XCTAssertEqual(section.rows.map(\.action), [.addKeys])
        XCTAssertEqual(section.rows.first?.action.title, "Add keys")
    }

    func testTwoNamedAccountsStaySeparateAndOnlyOneAddAnotherRowAppears() {
        let section = ConnectionCredentialsPresentation(
            catalog: [catalogService(id: "notion", name: "Notion", keys: ["NOTION_API_KEY"])],
            connections: [
                connection(id: "personal", serviceId: "notion", name: "Personal Notion", status: "connected", keys: ["NOTION_PERSONAL_API_KEY"]),
                connection(id: "work", serviceId: "notion", name: "Work Notion", status: "connected", keys: ["NOTION_WORK_API_KEY"]),
            ]
        )

        XCTAssertEqual(section.rows.map(\.name), ["Personal Notion", "Work Notion", "Notion"])
        XCTAssertEqual(section.rows.map(\.action), [.modifyKeys, .modifyKeys, .addAnother])
    }

    func testCatalogConnectionUsesRegistryReadinessInsteadOfStaleCatalogReadiness() {
        let section = ConnectionCredentialsPresentation(
            catalog: [catalogService(id: "tripmaster", name: "TripMaster", keys: ["TRIPMASTER_API_KEY"])],
            connections: [connection(
                id: "catalog:tripmaster",
                serviceId: "tripmaster",
                name: "TripMaster",
                status: "connected",
                keys: ["TRIPMASTER_API_KEY"]
            )]
        )

        XCTAssertEqual(section.rows.count, 1)
        XCTAssertEqual(section.rows.first?.action, .modifyKeys)
        XCTAssertEqual(section.rows.first?.status, .connected)
    }

    private func catalogService(id: String, name: String, keys: [String]) -> ConnectionCatalogService {
        ConnectionCatalogService(id: id, name: name, requiredEnvironmentKeys: keys)
    }

    private func connection(
        id: String,
        serviceId: String,
        name: String,
        status: String,
        keys: [String]
    ) -> GuidanceServiceConnection {
        GuidanceServiceConnection(
            id: id,
            serviceId: serviceId,
            name: name,
            source: "configured_api",
            status: status,
            actions: ["read", "write"],
            actionsKnown: true,
            requiredEnvironmentKeys: keys
        )
    }
}
