import XCTest
@testable import AgentServerCore

final class SecurityPanelNavigationTests: XCTestCase {
    func testSecurityPanelUsesOneFlatNativePresentationHierarchy() {
        let presentation = SecurityPanelPresentation(scanPhase: .idle)

        XCTAssertEqual(presentation.visualPolicy.surfaceStyle, .flatSections)
        XCTAssertEqual(presentation.visualPolicy.findingStyle, .rows)
        XCTAssertEqual(
            presentation.visualPolicy.textRoles,
            [.title, .body, .secondary, .technical]
        )
    }

    func testAgentRowsUseTheSameDisclosureAccessoryWhenTheyOpenDetails() {
        let agents = [
            SecurityAgentPresentation(
                id: "checked",
                name: "Checked agent",
                result: .checked(risk: .low, findingCount: 0, isStale: false)
            ),
            SecurityAgentPresentation(
                id: "failed",
                name: "Failed agent",
                result: .failed(message: "The check did not finish.")
            ),
            SecurityAgentPresentation(id: "pending", name: "Pending agent", result: .pending),
        ]

        let rows = agents.map { $0.securityRow(isSelected: $0.id == "checked") }

        XCTAssertEqual(rows.map(\.accessory), [.disclosure, .disclosure, .disclosure])
        XCTAssertEqual(rows.map(\.titleRole), [.body, .body, .body])
        XCTAssertEqual(rows.map(\.detailRole), [.secondary, .secondary, .secondary])
        XCTAssertTrue(rows[0].isSelected)
        XCTAssertFalse(rows[1].isSelected)
    }

    func testFindingRowsKeepSupportingInformationOutOfTheListHierarchy() {
        let finding = SecurityFindingPresentation(
            id: "broad-files",
            severity: .high,
            title: "This agent can edit your entire home folder",
            whyItMatters: "This is broader than the agent needs.",
            potentialImpact: "It could change unrelated personal files.",
            trigger: "working_directory: ~/",
            recommendation: "Limit editing to Documents/Reports.",
            functionalityImpact: "The agent can still edit reports.",
            canFix: true
        )

        let row = finding.securityRow(isSelected: true)

        XCTAssertEqual(row.title, finding.title)
        XCTAssertEqual(row.detail, finding.whyItMatters)
        XCTAssertEqual(row.accessory, .disclosure)
        XCTAssertTrue(row.isSelected)
        XCTAssertFalse(row.visibleText.contains(finding.potentialImpact))
        XCTAssertFalse(row.visibleText.contains(finding.recommendation))
        XCTAssertFalse(row.visibleText.contains(finding.trigger))
    }

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

    func testSelectingAFindingKeepsItsAgentAndTheAgentListVisible() {
        var navigation = SecurityPanelNavigationState(selectedAgentId: "weekly-summary")

        navigation.selectFinding("broad-files")

        XCTAssertEqual(navigation.selectedAgentId, "weekly-summary")
        XCTAssertEqual(navigation.selectedFindingId, "broad-files")
        XCTAssertEqual(navigation.visiblePanelCount, 3)
        XCTAssertTrue(navigation.stepBack())
        XCTAssertEqual(navigation.selectedAgentId, "weekly-summary")
        XCTAssertNil(navigation.selectedFindingId)
        XCTAssertEqual(navigation.visiblePanelCount, 2)
    }

    func testChangingAgentsClearsThePreviousFindingDetail() {
        var navigation = SecurityPanelNavigationState(selectedAgentId: "agent-a")
        navigation.selectFinding("finding-a")

        navigation.selectAgent("agent-b")

        XCTAssertEqual(navigation.selectedAgentId, "agent-b")
        XCTAssertNil(navigation.selectedFindingId)
    }

    func testChangingAgentsChangesTheAnalysisIdentity() {
        var navigation = SecurityPanelNavigationState(selectedAgentId: "agent-a")

        let firstIdentity = navigation.analysisIdentity
        navigation.selectAgent("agent-b")

        XCTAssertEqual(firstIdentity, "agent-a")
        XCTAssertEqual(navigation.analysisIdentity, "agent-b")
        XCTAssertNotEqual(firstIdentity, navigation.analysisIdentity)
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
