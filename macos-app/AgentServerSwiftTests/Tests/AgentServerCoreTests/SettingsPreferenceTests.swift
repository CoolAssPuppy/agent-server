import XCTest
@testable import AgentServerCore

final class SettingsPreferenceTests: XCTestCase {
    func testSettingsLeadWithEverydayChoicesAndKeepInfrastructureAdvanced() {
        XCTAssertEqual(
            SettingsPresentation.primarySections,
            [.general, .device, .notifications, .appearance, .updates]
        )
        XCTAssertEqual(
            SettingsPresentation.advancedSections,
            [.runtimes, .storage, .agentPanel, .telemetry, .environment, .security]
        )
    }

    func testSettingsSectionsUseConsumerFacingSentenceCaseTitles() {
        XCTAssertEqual(
            SettingsSection.allCases.map(\.title),
            [
                "General",
                "This Mac",
                "Notifications",
                "Appearance",
                "Updates",
                "AI engine",
                "Local server",
                "Agent Panel",
                "Diagnostics and telemetry",
                "Environment",
                "Security",
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
        XCTAssertEqual(SettingsPresentation.cardHeadingBottomPadding, 12)
        XCTAssertEqual(SettingsPresentation.rowHorizontalSpacing, 12)
        XCTAssertEqual(SettingsPresentation.rowTextSpacing, 2)
        XCTAssertEqual(SettingsPresentation.rowDividerVerticalPadding, 10)
    }

    func testSettingsUseOneCompactButtonGeometry() {
        XCTAssertEqual(SettingsPresentation.secondaryButtonFontSize, 11)
        XCTAssertEqual(SettingsPresentation.secondaryButtonHorizontalPadding, 11)
        XCTAssertEqual(SettingsPresentation.secondaryButtonVerticalPadding, 6)
        XCTAssertEqual(SettingsPresentation.secondaryButtonCornerRadius, 8)
        XCTAssertEqual(SettingsPresentation.iconButtonFontSize, 12)
        XCTAssertEqual(SettingsPresentation.iconButtonWidth, 28)
        XCTAssertEqual(SettingsPresentation.iconButtonHeight, 26)
    }

    func testPrimarySettingsKeepUpdatesInTheRightColumn() {
        XCTAssertEqual(
            SettingsPresentation.primaryColumns,
            [
                [.general, .device, .notifications],
                [.appearance, .updates],
            ]
        )
    }

    func testCurrentDeviceSummaryUsesHumanStatusAndKeepsIdentityTechnical() {
        let summary = CurrentDevicePresentation(
            machineID: "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99",
            protocolVersion: 2,
            serverVersion: "3.3.4",
            assistantCount: 4,
            isServerReachable: true,
            lastHeardAt: Date(timeIntervalSince1970: 1_786_050_000)
        )

        XCTAssertEqual(summary.name, "This Mac")
        XCTAssertEqual(summary.status, "Online")
        XCTAssertEqual(summary.assistantCountText, "4 assistants")
        XCTAssertEqual(summary.machineID, "1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99")
        XCTAssertEqual(summary.protocolText, "Protocol 2")
        XCTAssertEqual(summary.serverVersionText, "Agent Server 3.3.4")
    }

    func testCurrentDeviceSummaryExplainsOfflineStateWithoutClaimingAssistantsStopped() {
        let summary = CurrentDevicePresentation(
            machineID: "machine-1",
            protocolVersion: 2,
            serverVersion: "3.3.4",
            assistantCount: 1,
            isServerReachable: false,
            lastHeardAt: nil
        )

        XCTAssertEqual(summary.status, "Local server unavailable")
        XCTAssertEqual(summary.assistantCountText, "1 assistant")
        XCTAssertEqual(summary.lastHeardText, "Not checked yet")
    }

    func testCurrentDeviceNameIsEditableButNeverBlankOrUnbounded() {
        XCTAssertEqual(CurrentDevicePresentation.normalizedName("  Office Mac  "), "Office Mac")
        XCTAssertEqual(CurrentDevicePresentation.normalizedName("   "), "This Mac")
        XCTAssertEqual(CurrentDevicePresentation.normalizedName(String(repeating: "x", count: 100)).count, 80)
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
