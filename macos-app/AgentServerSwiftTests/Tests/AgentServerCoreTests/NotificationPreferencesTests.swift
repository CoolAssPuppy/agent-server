import XCTest
@testable import AgentServerCore

final class NotificationPreferencesTests: XCTestCase {

    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "test-" + UUID().uuidString
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    // MARK: Defaults

    func testBothTogglesDefaultOn() {
        let prefs = NotificationPreferences(defaults: defaults)
        XCTAssertTrue(prefs.enabled)
        XCTAssertTrue(prefs.includeAgentOutput)
    }

    // MARK: Persistence

    func testEnabledPersistsAcrossInstances() {
        let first = NotificationPreferences(defaults: defaults)
        first.enabled = false

        let second = NotificationPreferences(defaults: defaults)
        XCTAssertFalse(second.enabled)
    }

    func testIncludeAgentOutputPersistsAcrossInstances() {
        let first = NotificationPreferences(defaults: defaults)
        first.includeAgentOutput = false

        let second = NotificationPreferences(defaults: defaults)
        XCTAssertFalse(second.includeAgentOutput)
    }

    // MARK: Gate matrix

    func testBothOnAllowsAllCategories() {
        let prefs = NotificationPreferences(defaults: defaults)
        XCTAssertTrue(prefs.shouldPost(.systemEvent))
        XCTAssertTrue(prefs.shouldPost(.agentOutput))
    }

    func testMasterOffSuppressesEverything() {
        let prefs = NotificationPreferences(defaults: defaults)
        prefs.enabled = false
        XCTAssertFalse(prefs.shouldPost(.systemEvent))
        XCTAssertFalse(prefs.shouldPost(.agentOutput))
    }

    func testMasterOnOutputOffAllowsOnlySystemEvents() {
        let prefs = NotificationPreferences(defaults: defaults)
        prefs.includeAgentOutput = false
        XCTAssertTrue(prefs.shouldPost(.systemEvent))
        XCTAssertFalse(prefs.shouldPost(.agentOutput))
    }

    func testMasterOffOutputOnStillSuppresses() {
        let prefs = NotificationPreferences(defaults: defaults)
        prefs.enabled = false
        prefs.includeAgentOutput = true
        XCTAssertFalse(prefs.shouldPost(.systemEvent))
        XCTAssertFalse(prefs.shouldPost(.agentOutput))
    }
}
