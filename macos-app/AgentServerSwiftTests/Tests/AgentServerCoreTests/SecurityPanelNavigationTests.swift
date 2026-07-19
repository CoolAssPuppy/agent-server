import XCTest
@testable import AgentServerCore

final class SecurityPanelNavigationTests: XCTestCase {
    func testSelectingAnAgentAddsADetailPanelWithoutRemovingTheList() {
        var navigation = SecurityPanelNavigationState()

        navigation.selectAgent("weekly-summary")

        XCTAssertEqual(navigation.selectedAgentId, "weekly-summary")
        XCTAssertEqual(navigation.visiblePanelCount, 2)
    }

    func testSteppingBackClosesDetailsBeforeTheDrawer() {
        var navigation = SecurityPanelNavigationState(selectedAgentId: "weekly-summary")

        XCTAssertTrue(navigation.stepBack())
        XCTAssertNil(navigation.selectedAgentId)
        XCTAssertEqual(navigation.visiblePanelCount, 1)
        XCTAssertFalse(navigation.stepBack())
    }

    func testDirectAgentEntryStartsWithBothPanelsVisible() {
        let navigation = SecurityPanelNavigationState(selectedAgentId: "weekly-summary")

        XCTAssertEqual(navigation.visiblePanelCount, 2)
    }
}
