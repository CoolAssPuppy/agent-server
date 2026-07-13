import XCTest
@testable import AgentServerCore

final class AgentTriggerPresentationTests: XCTestCase {
    func testScheduledAgentUsesCronDescription() {
        let presentation = AgentTriggerPresentation(schedule: "0 9 * * *", hasWatch: false)

        XCTAssertEqual(presentation.kind, .scheduled)
        XCTAssertEqual(presentation.fallbackLabel, nil)
    }

    func testWatchOnlyAgentUsesFileWatchLabel() {
        let presentation = AgentTriggerPresentation(schedule: nil, hasWatch: true)

        XCTAssertEqual(presentation.kind, .watcher)
        XCTAssertEqual(presentation.fallbackLabel, "File watch")
    }

    func testOnDemandAgentUsesOnDemandLabel() {
        let presentation = AgentTriggerPresentation(schedule: nil, hasWatch: false)

        XCTAssertEqual(presentation.kind, .onDemand)
        XCTAssertEqual(presentation.fallbackLabel, "On demand")
    }

    func testAllNonRunningDefinitionsRemainAvailableRegardlessOfTriggerOrEnabledState() {
        let available = AgentCatalogPresentation.availableAgentIds(
            agentIds: ["scheduled", "watch-only", "on-demand", "disabled"],
            runningAgentIds: ["scheduled"]
        )

        XCTAssertEqual(available, ["watch-only", "on-demand", "disabled"])
    }
}
