import SwiftUI
import XCTest

@testable import NerdsUI

final class NerdsUITests: XCTestCase {
    func testSpacingUsesAConsistentFourPointGridAfterTheHairlineToken() {
        XCTAssertEqual(NSpacing.xxxs, 2)
        XCTAssertEqual(
            [NSpacing.xxs, NSpacing.xs, NSpacing.sm, NSpacing.md, NSpacing.lg, NSpacing.xl, NSpacing.xxl, NSpacing.huge],
            [4, 8, 12, 16, 24, 32, 48, 64]
        )
    }

    func testThemeConfigurationPreservesPaletteIdentity() {
        let configuration = ThemeConfiguration(palette: TestPalette())

        XCTAssertEqual(configuration.id, "test")
        XCTAssertEqual(configuration.displayName, "Test")
        XCTAssertTrue(configuration.isDark)
    }
}

private struct TestPalette: AppPalette {
    let id = "test"
    let displayName = "Test"
    let isDark = true
    let primary = Color.red
    let primaryForeground = Color.white
    let background = Color.black
    let foreground = Color.white
    let card = Color.gray
    let cardForeground = Color.white
    let muted = Color.gray
    let mutedForeground = Color.secondary
    let accent = Color.orange
    let accentForeground = Color.black
    let border = Color.gray
    let destructive = Color.red
}
