import XCTest
@testable import AgentServerCore

final class DrawerRouterTests: XCTestCase {

    func testTopDrawersUseOneNativeToolbarHierarchy() {
        XCTAssertEqual(TopDrawerPresentation.toolbarButtonSize, 28)
        XCTAssertEqual(TopDrawerPresentation.toolbarIconSize, 11)
        XCTAssertEqual(TopDrawerPresentation.dividerOpacity, 0.3)
    }

    func testFooterUtilitiesAreIconOnlyAndOrderedByIncreasingScope() {
        XCTAssertEqual(
            MainFooterUtilityDestination.allCases,
            [.security, .connections, .settings]
        )
        XCTAssertEqual(
            MainFooterUtilityDestination.allCases.map(\.title),
            ["Security check", "Connections", "Settings"]
        )
        XCTAssertTrue(MainFooterUtilityDestination.allCases.allSatisfy(\.isIconOnly))
    }

    func testStartsClosed() {
        let router = DrawerRouter()
        XCTAssertNil(router.open)
        XCTAssertFalse(router.isDetailOpen)
        XCTAssertFalse(router.isSettingsOpen)
        XCTAssertFalse(router.isPresentationActive)
    }

    func testEveryDrawerMakesTheBackgroundInert() {
        let presentations: [Drawer] = [
            .creation(),
            .detail(agentId: "agent-1"),
            .settings,
            .connections,
            .security(agentId: nil),
            .debugger(runId: "run-1")
        ]

        for presentation in presentations {
            XCTAssertTrue(DrawerRouter(open: presentation).isPresentationActive)
        }
    }

    func testAgentDetailKeepsSidebarAvailableForReplacingOrClosingSelection() {
        XCTAssertTrue(DrawerRouter().allowsSidebarInteraction)
        XCTAssertTrue(
            DrawerRouter(open: .detail(agentId: "agent-1")).allowsSidebarInteraction
        )
        XCTAssertFalse(DrawerRouter(open: .settings).allowsSidebarInteraction)
        XCTAssertFalse(DrawerRouter(open: .creation()).allowsSidebarInteraction)
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

    func testClosingSecurityReturnsToItsAgentOrClosesTheDashboard() {
        let dashboardRouter = DrawerRouter(open: .security(agentId: nil))
        dashboardRouter.closeSecurity()
        XCTAssertNil(dashboardRouter.open)

        let agentRouter = DrawerRouter(open: .security(agentId: "agent-1"))
        agentRouter.closeSecurity()
        XCTAssertEqual(agentRouter.open, .detail(agentId: "agent-1"))
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

    func testSimilarCreationRetainsOnlySourceAgentIdentifier() {
        let router = DrawerRouter(open: .detail(agentId: "source-agent"))

        router.openCreation(sourceAgentId: "source-agent")

        XCTAssertTrue(router.isCreationOpen)
        XCTAssertEqual(router.creationSourceAgentId, "source-agent")
        XCTAssertNil(router.openAgentId)
    }

    func testEscapeDismissesTheDeepestAgentDetailLayer() {
        XCTAssertEqual(
            AgentDetailDismissalPolicy.action(
                isSettingsPresented: true,
                isHistoryPresented: true
            ),
            .closeSettings
        )
        XCTAssertEqual(
            AgentDetailDismissalPolicy.action(
                isSettingsPresented: false,
                isHistoryPresented: true
            ),
            .closeHistory
        )
        XCTAssertEqual(
            AgentDetailDismissalPolicy.action(
                isSettingsPresented: false,
                isHistoryPresented: false
            ),
            .closeDetail
        )
    }
}
