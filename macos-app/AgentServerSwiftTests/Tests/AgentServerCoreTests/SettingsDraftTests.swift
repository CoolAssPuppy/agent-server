import XCTest
@testable import AgentServerCore

final class SettingsDraftTests: XCTestCase {
    func testLoadedEnvironmentDerivesSettingsWithoutRestartDirtiness() {
        let draft = SettingsDraft(pairs: [
            EnvPair(key: SettingsDraft.catchUpKey, value: "false"),
            EnvPair(key: SettingsDraft.useInstalledCodexKey, value: "false"),
        ])

        XCTAssertFalse(draft.resumeAfterWake)
        XCTAssertFalse(draft.runtimeSelection.usesInstalledCodex)
        XCTAssertFalse(draft.requiresGeneralRestart)
        XCTAssertFalse(draft.requiresRuntimeRestart)
        XCTAssertFalse(draft.requiresPanelRestart)
    }

    func testUpdatesPreserveUnrelatedPairsAndTrackRestartDirtiness() {
        var draft = SettingsDraft(pairs: [EnvPair(key: "UNRELATED", value: "kept")])

        draft.setResumeAfterWake(false)
        draft.setRuntimeSelection(RuntimeSelection(
            usesInstalledClaude: true,
            usesInstalledCodex: false,
            usesInstalledKimi: true
        ))

        XCTAssertEqual(draft.pairs.first, EnvPair(key: "UNRELATED", value: "kept"))
        XCTAssertTrue(draft.requiresGeneralRestart)
        XCTAssertTrue(draft.requiresRuntimeRestart)

        draft.acknowledgeGeneralRestart()
        draft.acknowledgeRuntimeRestart()
        XCTAssertFalse(draft.requiresGeneralRestart)
        XCTAssertFalse(draft.requiresRuntimeRestart)
    }

    func testValidationReportsInvalidAndDuplicateEnvironmentKeys() {
        let invalid = SettingsDraft(pairs: [EnvPair(key: "bad key", value: "value")])
        let duplicate = SettingsDraft(pairs: [
            EnvPair(key: "DUPLICATE", value: "one"),
            EnvPair(key: "DUPLICATE", value: "two"),
        ])

        XCTAssertEqual(invalid.invalidKeys, ["bad key"])
        XCTAssertThrowsError(try invalid.validatedPairs()) { error in
            XCTAssertEqual(error as? SettingsDraftError, .invalidKey("bad key"))
        }
        XCTAssertEqual(duplicate.invalidKeys, ["DUPLICATE"])
        XCTAssertThrowsError(try duplicate.validatedPairs()) { error in
            XCTAssertEqual(error as? SettingsDraftError, .duplicateKey("DUPLICATE"))
        }
    }

    func testLoadAndSaveFailuresProduceUserFacingErrors() {
        var draft = SettingsDraft()

        draft.recordLoadFailure(fileName: ".env", description: "Permission denied")
        XCTAssertEqual(draft.saveError, "Could not load .env: Permission denied")

        draft.recordSaveFailure(.duplicateKey("PANEL_URL"))
        XCTAssertEqual(draft.saveError, "Duplicate key: PANEL_URL")

        draft.recordSaveSuccess()
        XCTAssertNil(draft.saveError)
    }

    func testPanelSendingIsGatedByCredentialsAndReportsConnectionState() {
        var draft = SettingsDraft()

        XCTAssertFalse(draft.setPanelSendingEnabled(true))
        XCTAssertEqual(draft.panelConnection(isServerReachable: true), .notSetUp)

        draft = SettingsDraft(pairs: [
            EnvPair(key: "AGENT_SERVER_PANEL_URL", value: "https://panel.example"),
            EnvPair(key: "AGENT_SERVER_PANEL_API_KEY", value: "secret"),
        ])
        XCTAssertTrue(draft.setPanelSendingEnabled(false))
        XCTAssertEqual(draft.panelConnection(isServerReachable: true), .off)
        XCTAssertTrue(draft.requiresPanelRestart)

        XCTAssertTrue(draft.setPanelSendingEnabled(true))
        XCTAssertEqual(draft.panelConnection(isServerReachable: false), .reconnecting)
        XCTAssertEqual(draft.panelConnection(isServerReachable: true), .connected)
        XCTAssertFalse(draft.requiresPanelRestart)
    }

    func testTelemetryUpdatesPersistAndRequirePanelRestart() {
        var draft = SettingsDraft(pairs: [EnvPair(key: "UNRELATED", value: "kept")])
        let telemetry = TelemetryProgressSettings(
            mode: .batched,
            sampleSeconds: 30,
            maxEntries: 20,
            includesMetadata: true
        )

        draft.setTelemetryProgress(telemetry)

        XCTAssertEqual(draft.telemetryProgress, telemetry)
        XCTAssertEqual(draft.pairs.first, EnvPair(key: "UNRELATED", value: "kept"))
        XCTAssertTrue(draft.requiresPanelRestart)

        draft.setTelemetryProgress(.default)
        XCTAssertFalse(draft.requiresPanelRestart)
    }

    func testReloadGenerationRejectsStaleWorkspaceResults() {
        var draft = SettingsDraft(pairs: [EnvPair(key: "ORIGINAL", value: "one")])
        let staleGeneration = draft.beginWorkspaceReload()
        let currentGeneration = draft.beginWorkspaceReload()

        XCTAssertFalse(draft.applyReloadedPairs(
            [EnvPair(key: "STALE", value: "ignored")],
            generation: staleGeneration
        ))
        XCTAssertTrue(draft.applyReloadedPairs(
            [EnvPair(key: "CURRENT", value: "accepted")],
            generation: currentGeneration
        ))
        XCTAssertEqual(draft.pairs, [EnvPair(key: "CURRENT", value: "accepted")])
    }
}
