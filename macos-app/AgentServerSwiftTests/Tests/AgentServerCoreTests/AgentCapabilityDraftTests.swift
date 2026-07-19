import XCTest
@testable import AgentServerCore

final class AgentCapabilityDraftTests: XCTestCase {
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
