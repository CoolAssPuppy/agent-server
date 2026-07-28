import XCTest
@testable import AgentServerCore

final class TelemetryEventTests: XCTestCase {

    private let allEvents: [TelemetryEvent] = [
        .appLaunched,
        .windowOpened,
        .agentDiscovered,
        .runStarted,
        .runCompleted,
        .runFailed,
        .agentCreated,
        .agentCreationFailed,
        .agentUpdated,
        .agentDeleted,
        .agentCapabilityToggled,
        .agentCreationUnsupportedServicesMentioned,
        .runTriggered,
        .runTriggerFailed,
        .runCancelled,
        .runHistoryPanelEnrichmentFailed,
        .decisionEmitted,
        .decisionResolved,
        .connectionCreated,
        .connectionRemoved,
        .connectionKeysSaved,
        .daemonLaunchFailed,
        .daemonRestartRequested,
        .settingChanged,
        .updateCheckRequested,
        .updateInstalled,
    ]

    func testEveryEventNameIsLowercaseSnakeCase() {
        for event in allEvents {
            XCTAssertTrue(
                event.rawValue.range(of: "^[a-z][a-z0-9]*(_[a-z0-9]+)*$", options: .regularExpression) != nil,
                "\(event.rawValue) is not snake_case"
            )
        }
    }

    func testEventNamesAreUnique() {
        let names = allEvents.map(\.rawValue)
        XCTAssertEqual(Set(names).count, names.count)
    }

    func testEventNamesShippedBeforeTheCatalogKeepTheirSpelling() {
        // These six were already flowing into the analytics project as string
        // literals. Renaming any of them orphans the history behind it.
        XCTAssertEqual(TelemetryEvent.appLaunched.rawValue, "app_launched")
        XCTAssertEqual(TelemetryEvent.agentDiscovered.rawValue, "agent_discovered")
        XCTAssertEqual(TelemetryEvent.decisionEmitted.rawValue, "decision_emitted")
        XCTAssertEqual(TelemetryEvent.runStarted.rawValue, "run_started")
        XCTAssertEqual(TelemetryEvent.runCompleted.rawValue, "run_completed")
        XCTAssertEqual(TelemetryEvent.runFailed.rawValue, "run_failed")
    }

    func testDrawerRoutesAreNamedWithoutTheirIdentifiers() {
        XCTAssertEqual(Drawer.settings.analyticsRoute, "settings")
        XCTAssertEqual(Drawer.detail(agentId: "quarterly-board-review").analyticsRoute, "detail")
        XCTAssertEqual(Drawer.debugger(runId: "run-1").analyticsRoute, "debugger")
        XCTAssertEqual(Drawer.creation(sourceAgentId: "acme-invoices").analyticsRoute, "creation")
    }

    func testTriggerFailuresReportACoarseReason() {
        XCTAssertEqual(AgentRunTriggerFailure.offline.analyticsReason, "offline")
        XCTAssertEqual(AgentRunTriggerFailure.takingLonger.analyticsReason, "taking_longer")
        XCTAssertEqual(AgentRunTriggerFailure.missingConnection.analyticsReason, "missing_connection")
        XCTAssertEqual(AgentRunTriggerFailure.securityBlocked.analyticsReason, "security_blocked")
    }
}
