import XCTest
@testable import AgentServerCore

final class SecurityPanelNavigationTests: XCTestCase {
    func testSecurityPanelPutsExportAndRescanBeforeCloseWithoutASubtitle() {
        let presentation = SecurityPanelPresentation(scanPhase: .idle)

        XCTAssertEqual(presentation.headerActions, [.exportReport, .scanAll])
        XCTAssertEqual(presentation.headerActions.map(\.systemImage), ["square.and.arrow.down", "arrow.triangle.2.circlepath"])
        XCTAssertFalse(presentation.showsSubtitle)
    }

    func testScanningReplacesOnlyOverallStatusAndKeepsAgentListVisible() {
        let presentation = SecurityPanelPresentation(scanPhase: .scanning)

        XCTAssertEqual(presentation.overallStatusContent, .scanProgress)
        XCTAssertTrue(presentation.showsAgentList)
    }

    func testCompletedPanelShowsSummaryAndAgentList() {
        let presentation = SecurityPanelPresentation(scanPhase: .complete)

        XCTAssertEqual(presentation.overallStatusContent, .summary)
        XCTAssertTrue(presentation.showsAgentList)
    }

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
