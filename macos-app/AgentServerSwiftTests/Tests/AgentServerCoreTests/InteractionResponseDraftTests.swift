import XCTest

@testable import AgentServerCore

final class InteractionResponseDraftTests: XCTestCase {
    func testSelectingAnOptionProducesTheServerIndexedReply() {
        var draft = InteractionResponseDraft(allowsFreeText: true)

        draft.setText("A typed answer")
        draft.selectOption(index: 3)

        XCTAssertEqual(draft.reply, .option(index: 3))
        XCTAssertEqual(draft.text, "")
        XCTAssertTrue(draft.canSubmit)
    }

    func testTypingAResponseClearsAnOptionAndTrimsTheSubmittedValue() {
        var draft = InteractionResponseDraft(allowsFreeText: true)

        draft.selectOption(index: 1)
        draft.setText("  Save it privately  ")

        XCTAssertNil(draft.selectedOptionIndex)
        XCTAssertEqual(draft.reply, .text("Save it privately"))
    }

    func testBlankOrDisallowedTextCannotBeSubmitted() {
        var allowed = InteractionResponseDraft(allowsFreeText: true)
        allowed.setText("   ")
        var disallowed = InteractionResponseDraft(allowsFreeText: false)
        disallowed.setText("An answer")

        XCTAssertFalse(allowed.canSubmit)
        XCTAssertNil(allowed.reply)
        XCTAssertEqual(disallowed.text, "")
        XCTAssertFalse(disallowed.canSubmit)
    }
}
