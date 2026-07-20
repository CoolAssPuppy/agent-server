import XCTest
@testable import AgentServerCore

final class ThemePickerPresentationTests: XCTestCase {
    func testHoverExpandsTheThemeChoicesAndLeavingCollapsesThem() {
        var picker = ThemePickerPresentation()

        picker.setHovering(true)
        XCTAssertTrue(picker.isExpanded)

        picker.setHovering(false)
        XCTAssertFalse(picker.isExpanded)
    }

    func testKeyboardToggleAndSelectionKeepThePickerDirectlyControllable() {
        var picker = ThemePickerPresentation()

        picker.toggleExpanded()
        XCTAssertTrue(picker.isExpanded)

        picker.didSelectTheme()
        XCTAssertFalse(picker.isExpanded)
    }

    func testReducedMotionRemovesBounceWithoutChangingPickerBehavior() {
        XCTAssertEqual(ThemePickerPresentation.motion(reduceMotion: false), .bouncy)
        XCTAssertEqual(ThemePickerPresentation.motion(reduceMotion: true), .none)
    }
}
