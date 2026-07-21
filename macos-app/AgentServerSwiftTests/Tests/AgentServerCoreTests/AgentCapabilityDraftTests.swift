import XCTest
@testable import AgentServerCore

final class AgentCapabilityDraftTests: XCTestCase {
    func testEditActionsOnlyAppearWhenDraftDiffersFromAuthoritativeAgent() {
        XCTAssertFalse(AgentSettingsSavePresentation.showsActions(isDirty: false))
        XCTAssertTrue(AgentSettingsSavePresentation.showsActions(isDirty: true))
    }

    func testEmbeddedSettingsKeepTheirTabAndExposeSaveFeedback() {
        XCTAssertFalse(AgentSettingsSavePresentation.shouldDismissAfterSave(isEmbedded: true))
        XCTAssertTrue(AgentSettingsSavePresentation.shouldDismissAfterSave(isEmbedded: false))
        XCTAssertEqual(AgentSettingsSaveFeedback.saved.message, "Saved")
        XCTAssertEqual(AgentSettingsSaveFeedback.noChanges.message, "No changes to save")
    }

    func testAgentSettingsUseOneFormWithFocusedEditingControls() {
        let presentation = AgentSettingsSupportingSurfacePresentation()

        XCTAssertEqual(presentation.containerStyle, .nativeForm)
        XCTAssertEqual(
            presentation.sections,
            [.basics, .model, .instructions, .capabilities, .delete]
        )
        XCTAssertEqual(presentation.capabilityRowStyle, .plain)
        XCTAssertEqual(presentation.customCapabilityIndicator, .secondaryText)
        XCTAssertEqual(presentation.descriptionFieldStyle, .multilineFullWidth)
        XCTAssertEqual(presentation.rawFileActionPlacement, .instructionsHeaderTrailing)
        XCTAssertNil(presentation.capabilityFooter)
        XCTAssertTrue(presentation.areErrorsSelectable)
    }

    func testCapabilityChangesStayStagedUntilTheSettingsPatchIsBuilt() {
        var draft = AgentCapabilityDraft(initialValues: ["files-write": true, "network": false])

        draft.set("files-write", enabled: false)

        XCTAssertFalse(draft.isEnabled("files-write", fallback: true))
        XCTAssertEqual(draft.changes, [AgentCapabilityChange(id: "files-write", enabled: false)])
    }

    func testReturningACapabilityToItsOriginalValueRemovesTheChange() {
        var draft = AgentCapabilityDraft(initialValues: ["files-write": true])

        draft.set("files-write", enabled: false)
        draft.set("files-write", enabled: true)

        XCTAssertTrue(draft.changes.isEmpty)
    }
}
