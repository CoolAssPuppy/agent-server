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

    func testSettingsSectionsUseConsumerFacingSentenceCaseTitles() {
        XCTAssertEqual(
            SettingsSection.allCases.map(\.title),
            [
                "General",
                "Coding agents",
                "Notifications",
                "Agent Server folder",
                "Updates",
                "Agent Panel",
                "Environment",
            ]
        )
    }

    func testSettingsUseResponsiveArrangedCards() {
        XCTAssertEqual(SettingsPresentation.sectionStyle, .card)
        XCTAssertEqual(SettingsPresentation.columnCount(availableWidth: 900), 2)
        XCTAssertEqual(SettingsPresentation.columnCount(availableWidth: 620), 1)
    }

    func testSettingsMatchMailNotifierCompactTypographyAndSpacing() {
        XCTAssertEqual(SettingsPresentation.drawerTitleFontSize, 18)
        XCTAssertEqual(SettingsPresentation.cardHeadingFontSize, 10)
        XCTAssertEqual(SettingsPresentation.rowTitleFontSize, 13)
        XCTAssertEqual(SettingsPresentation.supportingFontSize, 11)
        XCTAssertEqual(SettingsPresentation.cardHeadingTracking, 0.6)
        XCTAssertTrue(SettingsPresentation.usesUppercaseCardHeadings)
        XCTAssertEqual(SettingsPresentation.interCardSpacing, 14)
        XCTAssertEqual(SettingsPresentation.outerHorizontalPadding, 22)
        XCTAssertEqual(SettingsPresentation.outerTopPadding, 18)
        XCTAssertEqual(SettingsPresentation.outerBottomPadding, 14)
        XCTAssertEqual(SettingsPresentation.headerHorizontalPadding, 24)
        XCTAssertEqual(SettingsPresentation.headerVerticalPadding, 18)
        XCTAssertEqual(SettingsPresentation.cardHorizontalPadding, 20)
        XCTAssertEqual(SettingsPresentation.cardVerticalPadding, 18)
    }

    func testPrimarySettingsKeepUpdatesInTheRightColumn() {
        XCTAssertEqual(
            SettingsPresentation.primaryColumns,
            [
                [.general, .runtimes, .notifications],
                [.storage, .updates],
            ]
        )
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
