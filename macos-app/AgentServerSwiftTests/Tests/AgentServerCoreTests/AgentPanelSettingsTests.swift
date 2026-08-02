import XCTest
@testable import AgentServerCore

final class AgentPanelSettingsTests: XCTestCase {
    func testSendingIsUnavailableUntilBothPanelValuesExist() {
        XCTAssertFalse(AgentPanelSettings(environment: [:]).hasRequiredCredentials)
        XCTAssertFalse(
            AgentPanelSettings(environment: ["AGENT_SERVER_PANEL_URL": "https://panel.example"])
                .hasRequiredCredentials
        )
        XCTAssertFalse(
            AgentPanelSettings(environment: ["AGENT_SERVER_PANEL_API_KEY": "secret"])
                .hasRequiredCredentials
        )
    }

    func testStoredDisableFlagTurnsSendingOffWithoutRemovingCredentials() {
        let settings = AgentPanelSettings(environment: [
            "AGENT_SERVER_PANEL_URL": "https://panel.example",
            "AGENT_SERVER_PANEL_API_KEY": "secret",
            "AGENT_SERVER_PANEL_ENABLED": "false",
        ])

        XCTAssertTrue(settings.hasRequiredCredentials)
        XCTAssertFalse(settings.isSendingEnabled)
        XCTAssertFalse(settings.allowsPanelRequests)
    }

    func testPanelRequestsRequireCredentialsAndAnEnabledPreference() {
        let incomplete = AgentPanelSettings(environment: [
            "AGENT_SERVER_PANEL_URL": "https://panel.example",
        ])
        let enabled = AgentPanelSettings(environment: [
            "AGENT_SERVER_PANEL_URL": "https://panel.example",
            "AGENT_SERVER_PANEL_API_KEY": "secret",
        ])

        XCTAssertFalse(incomplete.allowsPanelRequests)
        XCTAssertTrue(enabled.allowsPanelRequests)
    }
}
