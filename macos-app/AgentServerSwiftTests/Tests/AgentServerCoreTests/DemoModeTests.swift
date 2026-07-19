import XCTest
@testable import AgentServerCore

final class DemoModeTests: XCTestCase {
    func testContextMenuNamesTheActionThatWillHappen() {
        XCTAssertEqual(DemoModeState(isEnabled: false).contextMenuTitle, "Enable Demo Mode")
        XCTAssertEqual(DemoModeState(isEnabled: true).contextMenuTitle, "Disable Demo Mode")
    }

    func testPreferenceStaysLocalToTheSelectedDefaultsStore() {
        let suiteName = "DemoModeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let preference = DemoModePreference(defaults: defaults)

        XCTAssertFalse(preference.isEnabled)

        preference.setEnabled(true)
        XCTAssertTrue(DemoModePreference(defaults: defaults).isEnabled)

        preference.setEnabled(false)
        XCTAssertFalse(preference.isEnabled)
    }

    func testFixturesProvideStableScreenshotDataWithoutRealPaths() {
        let referenceDate = Date(timeIntervalSince1970: 1_752_921_600)
        let first = DemoModeFixtures.make(referenceDate: referenceDate)
        let second = DemoModeFixtures.make(referenceDate: referenceDate)

        XCTAssertEqual(first, second)
        XCTAssertGreaterThanOrEqual(first.agents.count, 6)
        XCTAssertGreaterThanOrEqual(first.runs.count, 8)
        XCTAssertTrue(first.runs.allSatisfy { run in
            first.agents.contains { $0.id == run.agentId }
        })
        XCTAssertTrue(first.runs.contains { $0.status == .running })
        XCTAssertTrue(first.runs.contains { $0.status == .completed })
        XCTAssertTrue(first.runs.contains { $0.status == .failed })
        XCTAssertFalse(first.agents.contains { $0.workingDirectory?.contains("/Users/") == true })
        XCTAssertFalse(first.runs.contains { run in
            (run.filesRead + run.filesWritten).contains { $0.contains("/Users/") }
        })
    }

    func testRunsCanBeFilteredForAnAgentWithoutChangingFixtureOrder() {
        let fixtures = DemoModeFixtures.make(
            referenceDate: Date(timeIntervalSince1970: 1_752_921_600)
        )
        let agentId = fixtures.agents[0].id

        XCTAssertEqual(
            fixtures.runs(for: agentId),
            fixtures.runs.filter { $0.agentId == agentId }
        )
    }
}
