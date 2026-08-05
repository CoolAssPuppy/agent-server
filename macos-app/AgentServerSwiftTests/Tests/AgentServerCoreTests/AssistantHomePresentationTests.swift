import XCTest

@testable import AgentServerCore

final class AssistantHomePresentationTests: XCTestCase {
    func testReadyHomeLeadsWithHealthOneActionAndHumanPermissionLanguage() throws {
        let presentation = AssistantHomePresentation(
            contract: try AssistantHomeContractTests.makeReadyHome()
        )

        XCTAssertEqual(presentation.health.label, "Healthy")
        XCTAssertEqual(presentation.health.symbol, "checkmark.circle.fill")
        XCTAssertEqual(presentation.primaryAction?.kind, .run)
        XCTAssertEqual(presentation.primaryAction?.label, "Run now")
        XCTAssertTrue(presentation.blockingChecks.isEmpty)
        XCTAssertEqual(presentation.passedChecks.count, 2)
        XCTAssertEqual(presentation.permissionLines.map(\.text), ["Can edit Reports"])
        XCTAssertEqual(presentation.scheduleText, "Runs every Monday at 9:00 AM.")
        XCTAssertEqual(presentation.destinationText, "Results go to Updated weekly report.")
        XCTAssertEqual(presentation.recentOutcomes.map(\.runId), ["run-7"])
        XCTAssertFalse(presentation.isAdvancedExpandedByDefault)
    }

    func testUnknownContractValuesStayVisibleButCannotBecomeAnActionOrHealthyState() throws {
        let presentation = AssistantHomePresentation(
            contract: try AssistantHomeContractTests.makeFutureHome()
        )

        XCTAssertEqual(presentation.health.label, "Needs attention")
        XCTAssertEqual(presentation.readinessLabel, "Readiness could not be verified")
        XCTAssertNil(presentation.primaryAction)
        XCTAssertTrue(presentation.blockingChecks.isEmpty)
        XCTAssertEqual(presentation.deferredChecks.count, 1)
        XCTAssertTrue(presentation.passedChecks.isEmpty)
        XCTAssertTrue(presentation.permissionLines.isEmpty)
    }

    func testChecksSettledDuringTheRunAreListedApartFromBlockers() throws {
        let presentation = AssistantHomePresentation(
            contract: try AssistantHomeContractTests.makeDeferredHome()
        )

        XCTAssertEqual(presentation.health.label, "Healthy")
        XCTAssertEqual(presentation.readinessLabel, "Ready")
        XCTAssertTrue(presentation.blockingChecks.isEmpty)
        XCTAssertEqual(
            presentation.deferredChecks.map(\.explanation.text),
            ["AI engine sign-in will be checked when this agent runs."]
        )
        XCTAssertEqual(presentation.passedChecks.count, 1)
    }

    func testRecentOutcomesAreNewestFirstWithoutRewritingTheirEvidence() throws {
        let contract = try AssistantHomeContractTests.makeReadyHome()
        let presentation = AssistantHomePresentation(contract: contract)

        XCTAssertEqual(
            presentation.recentOutcomes.first?.headline.evidenceReferences,
            ["run.status"]
        )
    }
}
