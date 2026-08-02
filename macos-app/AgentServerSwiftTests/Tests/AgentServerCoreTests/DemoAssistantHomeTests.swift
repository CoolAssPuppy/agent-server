import XCTest

@testable import AgentServerCore

final class DemoAssistantHomeTests: XCTestCase {
    func testReadyFixtureShowsOneConsumerActionAndEvidenceBackedSections() {
        let presentation = AssistantHomePresentation(contract: DemoAssistantHome.ready())

        XCTAssertEqual(presentation.contract.assistant.displayName, "Weekly Report")
        XCTAssertEqual(presentation.health.label, "Healthy")
        XCTAssertEqual(presentation.primaryAction?.label, "Run now")
        XCTAssertEqual(presentation.permissionLines.map(\.text), [
            "Can read Project notes",
            "Can edit Reports",
            "Cannot run terminal commands",
        ])
        XCTAssertEqual(presentation.contract.connections.map(\.label), ["Personal Notion"])
        XCTAssertEqual(presentation.recentOutcomes.count, 2)
    }
}
