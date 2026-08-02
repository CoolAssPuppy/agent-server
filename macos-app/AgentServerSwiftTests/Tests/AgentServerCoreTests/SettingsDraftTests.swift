import XCTest
@testable import AgentServerCore

final class SettingsDraftTests: XCTestCase {
    func testLoadedEnvironmentDerivesSettingsWithoutRestartDirtiness() {
        let draft = SettingsDraft(pairs: [
            EnvPair(key: SettingsDraft.catchUpKey, value: "false"),
            EnvPair(key: SettingsDraft.useInstalledKimiKey, value: "false"),
        ])

        XCTAssertFalse(draft.resumeAfterWake)
        XCTAssertFalse(draft.runtimeSelection.usesInstalledKimi)
        XCTAssertFalse(draft.requiresGeneralRestart)
        XCTAssertFalse(draft.requiresRuntimeRestart)
        XCTAssertFalse(draft.requiresPanelRestart)
    }

    func testUpdatesPreserveUnrelatedPairsAndTrackRestartDirtiness() {
        var draft = SettingsDraft(pairs: [EnvPair(key: "UNRELATED", value: "kept")])

        draft.setResumeAfterWake(false)
        draft.setRuntimeSelection(RuntimeSelection(usesInstalledKimi: false))

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
        XCTAssertEqual(draft.errorMessage, "Could not load .env: Permission denied")

        draft.recordPersistenceFailure(EnvFileStoreError.duplicateKey("PANEL_URL"))
        XCTAssertEqual(draft.errorMessage, "Duplicate key: PANEL_URL")

        draft.clearError()
        XCTAssertNil(draft.errorMessage)
    }

    func testFailedPersistedChangeRollsBackDraftAndKeepsAnActionableError() {
        var draft = SettingsDraft(pairs: [EnvPair(key: "ORIGINAL", value: "kept")])

        let didPersist = draft.persistChange(
            { $0.setResumeAfterWake(false) },
            using: { _ in throw EnvFileStoreError.writeFailed("Disk full") }
        )

        XCTAssertFalse(didPersist)
        XCTAssertEqual(draft.pairs, [EnvPair(key: "ORIGINAL", value: "kept")])
        XCTAssertFalse(draft.requiresGeneralRestart)
        XCTAssertEqual(draft.errorMessage, "Could not save .env: Disk full")
    }

    func testSuccessfulPersistedChangeCommitsTheDraftAndClearsAnOldError() {
        var draft = SettingsDraft()
        draft.recordLoadFailure(fileName: ".env", description: "Old error")
        var persistedPairs: [EnvPair] = []

        let didPersist = draft.persistChange(
            { $0.setResumeAfterWake(false) },
            using: { persistedPairs = $0 }
        )

        XCTAssertTrue(didPersist)
        XCTAssertEqual(persistedPairs, draft.pairs)
        XCTAssertTrue(draft.requiresGeneralRestart)
        XCTAssertNil(draft.errorMessage)
    }

    func testPanelSendingIsGatedByCredentialsAndReportsOnlyObservedStatus() {
        var draft = SettingsDraft()

        XCTAssertFalse(draft.setPanelSendingEnabled(true))
        XCTAssertEqual(draft.panelConnection(), .unavailable)

        draft = SettingsDraft(pairs: [
            EnvPair(key: "AGENT_SERVER_PANEL_URL", value: "https://panel.example"),
            EnvPair(key: "AGENT_SERVER_PANEL_API_KEY", value: "secret"),
        ])
        XCTAssertTrue(draft.setPanelSendingEnabled(false))
        XCTAssertEqual(draft.panelConnection(), .disabled)
        XCTAssertTrue(draft.requiresPanelRestart)

        XCTAssertTrue(draft.setPanelSendingEnabled(true))
        XCTAssertEqual(draft.panelConnection(), .configured)
        XCTAssertFalse(draft.panelConnection().rawValue.contains("Connected"))
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
