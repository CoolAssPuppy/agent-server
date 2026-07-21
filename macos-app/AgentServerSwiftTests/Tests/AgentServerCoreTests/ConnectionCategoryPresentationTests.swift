import XCTest
@testable import AgentServerCore

final class ConnectionCategoryPresentationTests: XCTestCase {
    func testRegistrySourcesUseConsumerConnectionCategories() {
        XCTAssertEqual(ConnectionCategory(source: "configured_api"), .api)
        XCTAssertEqual(ConnectionCategory(source: "account"), .mcp)
        XCTAssertEqual(ConnectionCategory(source: "mcp"), .mcp)
        XCTAssertEqual(ConnectionCategory(source: "macos"), .mac)
    }

    func testAgentCapabilitiesUseSpecificLocalCategories() {
        XCTAssertEqual(ConnectionCategory(capabilityID: "read-files", kind: "tools", auth: "none", source: nil), .file)
        XCTAssertEqual(ConnectionCategory(capabilityID: "write-files", kind: "tools", auth: "none", source: nil), .file)
        XCTAssertEqual(ConnectionCategory(capabilityID: "run-commands", kind: "tools", auth: "none", source: nil), .command)
        XCTAssertEqual(ConnectionCategory(capabilityID: "browse-web", kind: "tools", auth: "none", source: nil), .web)
        XCTAssertEqual(ConnectionCategory(capabilityID: "notion", kind: "mcp", auth: "api_key", source: nil), .api)
        XCTAssertEqual(ConnectionCategory(capabilityID: "slack", kind: "mcp", auth: "oauth", source: nil), .mcp)
    }

    func testCategoryLabelsStayCompact() {
        XCTAssertEqual(ConnectionCategory.api.label, "API")
        XCTAssertEqual(ConnectionCategory.mcp.label, "MCP")
        XCTAssertEqual(ConnectionCategory.file.label, "File")
        XCTAssertEqual(ConnectionCategory.messaging.label, "Messaging")
    }
}
