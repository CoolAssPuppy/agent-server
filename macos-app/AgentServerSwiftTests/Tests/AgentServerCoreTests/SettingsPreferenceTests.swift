import XCTest
@testable import AgentServerCore

final class SettingsPreferenceTests: XCTestCase {
    func testSettingsLeadWithEverydayChoicesAndKeepInfrastructureAdvanced() {
        XCTAssertEqual(
            SettingsPresentation.primarySections,
            [.general, .runtimes, .notifications, .storage, .updates]
        )
        XCTAssertEqual(
            SettingsPresentation.advancedSections,
            [.agentPanel, .environment]
        )
    }

    func testSettingsUseOneColumnWhenTwoReadableCardsWillNotFit() {
        XCTAssertEqual(SettingsPresentation.columnCount(availableWidth: 639), 1)
        XCTAssertEqual(SettingsPresentation.columnCount(availableWidth: 640), 2)
        XCTAssertEqual(SettingsPresentation.columnCount(availableWidth: 1_200), 2)
    }

    func testAbsentEnvironmentFlagUsesItsConsumerDefault() {
        let preference = EnvironmentBooleanPreference(
            key: "AGENT_SERVER_CATCH_UP",
            defaultValue: true
        )

        XCTAssertTrue(preference.value(in: []))
    }

    func testExplicitEnvironmentFlagOverridesItsConsumerDefault() {
        let preference = EnvironmentBooleanPreference(
            key: "AGENT_SERVER_CATCH_UP",
            defaultValue: true
        )

        XCTAssertFalse(preference.value(in: [
            EnvPair(key: "AGENT_SERVER_CATCH_UP", value: "false", isSecret: false)
        ]))
    }

    func testSavingTheDefaultRemovesTheRedundantEnvironmentFlag() {
        let preference = EnvironmentBooleanPreference(
            key: "AGENT_SERVER_CATCH_UP",
            defaultValue: true
        )
        let original = [
            EnvPair(key: "UNRELATED", value: "kept", isSecret: false),
            EnvPair(key: "AGENT_SERVER_CATCH_UP", value: "false", isSecret: false)
        ]

        XCTAssertEqual(preference.updating(original, to: true), [
            EnvPair(key: "UNRELATED", value: "kept", isSecret: false)
        ])
    }

    func testSavingANonDefaultEnvironmentFlagPreservesUnrelatedSettings() {
        let preference = EnvironmentBooleanPreference(
            key: "AGENT_SERVER_CATCH_UP",
            defaultValue: true
        )
        let original = [
            EnvPair(key: "AGENT_SERVER_CATCH_UP", value: "true", isSecret: false),
            EnvPair(key: "UNRELATED", value: "kept", isSecret: false)
        ]

        XCTAssertEqual(preference.updating(original, to: false), [
            EnvPair(key: "AGENT_SERVER_CATCH_UP", value: "false", isSecret: false),
            EnvPair(key: "UNRELATED", value: "kept", isSecret: false)
        ])
    }
}
