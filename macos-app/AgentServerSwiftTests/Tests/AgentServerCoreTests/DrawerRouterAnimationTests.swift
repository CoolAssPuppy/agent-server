import XCTest
@testable import AgentServerCore

/// Pre-conditions for the window+drawer open animation sequence.
///
/// The window-open animation relies on SwiftUI seeing the router transition
/// from `nil` -> `open`. These tests guard the invariants the AppDelegate's
/// deferred `routeTo(_:)` call depends on.
final class DrawerRouterAnimationTests: XCTestCase {

    func testRouteToFromNilOpensDetail() {
        let router = DrawerRouter()
        XCTAssertNil(router.open, "precondition: router must start closed so SwiftUI has a 'before' state")

        router.routeTo(.detail(agentId: "agent-1"))

        XCTAssertEqual(router.open, .detail(agentId: "agent-1"))
        XCTAssertTrue(router.isDetailOpen)
    }

    func testRouteToFromNilOpensSettings() {
        let router = DrawerRouter()
        XCTAssertNil(router.open)

        router.routeTo(.settings)

        XCTAssertTrue(router.isSettingsOpen)
    }

    func testCloseReturnsToNilForAnimatedExit() {
        // The window-close animation relies on the router going from
        // open -> nil so the drawer's .move transition can play the
        // reverse of its enter animation.
        let router = DrawerRouter(open: .detail(agentId: "x"))
        router.close()
        XCTAssertNil(router.open)
    }
}
