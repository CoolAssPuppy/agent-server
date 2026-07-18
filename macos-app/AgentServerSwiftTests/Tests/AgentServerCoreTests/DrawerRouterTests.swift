import XCTest
@testable import AgentServerCore

final class DrawerRouterTests: XCTestCase {

    func testStartsClosed() {
        let router = DrawerRouter()
        XCTAssertNil(router.open)
        XCTAssertFalse(router.isDetailOpen)
        XCTAssertFalse(router.isSettingsOpen)
    }

    func testOpenDetailSetsState() {
        let router = DrawerRouter()
        router.openDetail(agentId: "agent-1")
        XCTAssertEqual(router.open, .detail(agentId: "agent-1"))
        XCTAssertEqual(router.openAgentId, "agent-1")
    }

    func testOpeningSettingsClosesDetail() {
        let router = DrawerRouter(open: .detail(agentId: "agent-1"))
        router.openSettings()
        XCTAssertTrue(router.isSettingsOpen)
        XCTAssertFalse(router.isDetailOpen)
    }

    func testOpeningDetailClosesSettings() {
        let router = DrawerRouter(open: .settings)
        router.openDetail(agentId: "agent-2")
        XCTAssertTrue(router.isDetailOpen)
        XCTAssertFalse(router.isSettingsOpen)
        XCTAssertEqual(router.openAgentId, "agent-2")
    }

    func testReSelectingSameAgentClosesDetail() {
        let router = DrawerRouter()
        router.openDetail(agentId: "agent-1")
        router.openDetail(agentId: "agent-1")
        XCTAssertNil(router.open)
    }

    func testSelectingDifferentAgentSwapsContent() {
        let router = DrawerRouter()
        router.openDetail(agentId: "agent-1")
        router.openDetail(agentId: "agent-2")
        XCTAssertEqual(router.openAgentId, "agent-2")
    }

    func testCloseReturnsToNilState() {
        let router = DrawerRouter(open: .settings)
        router.close()
        XCTAssertNil(router.open)
    }

    func testSecurityDashboardAndAgentReviewUseOneDrawerRoute() {
        let router = DrawerRouter()

        router.openSecurity()
        XCTAssertTrue(router.isSecurityOpen)
        XCTAssertNil(router.securityAgentId)

        router.openSecurity(agentId: "agent-1")
        XCTAssertEqual(router.securityAgentId, "agent-1")
        XCTAssertFalse(router.isDetailOpen)
    }

    func testFailedRunOpensDebuggerAndKeepsRunIdentifier() {
        let router = DrawerRouter()

        router.openDebugger(runId: "run-failed")

        XCTAssertTrue(router.isDebuggerOpen)
        XCTAssertEqual(router.debugRunId, "run-failed")
        XCTAssertFalse(router.isSecurityOpen)
    }

    func testCreationRouteReplacesAnyOpenDrawer() {
        let router = DrawerRouter(open: .settings)

        router.openCreation()

        XCTAssertTrue(router.isCreationOpen)
        XCTAssertFalse(router.isSettingsOpen)
    }
}
