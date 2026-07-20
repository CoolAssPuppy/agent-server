import SwiftUI
import XCTest

@testable import AgentServerDesignSystem

final class AgentServerDesignSystemTests: XCTestCase {
    func testLayoutTokensPreserveTheEstablishedScale() {
        XCTAssertEqual(NSpacing.xxxs, 2)
        XCTAssertEqual(
            [NSpacing.xxs, NSpacing.xs, NSpacing.sm, NSpacing.md, NSpacing.lg, NSpacing.xl, NSpacing.xxl, NSpacing.huge],
            [4, 8, 12, 16, 24, 32, 48, 64]
        )
        XCTAssertEqual([NRadius.xs, NRadius.sm, NRadius.md, NRadius.lg], [4, 8, 12, 16])
        XCTAssertEqual([NIconSize.xs, NIconSize.lg], [12, 28])
    }

    func testThemeConfigurationForwardsPaletteColorsAndSemanticAliases() {
        let tokens = ThemeConfiguration(palette: TestPalette()).tokens

        XCTAssertEqual(tokens.primary, Color.red)
        XCTAssertEqual(tokens.background, Color.black)
        XCTAssertEqual(tokens.error, tokens.destructive)
    }

    func testSixDigitHexColorUsesOpaqueRgbComponents() {
        XCTAssertEqual(Color(hex: "#FF0000"), Color(.sRGB, red: 1, green: 0, blue: 0, opacity: 1))
    }
}

private struct TestPalette: AppPalette {
    let isDark = true
    let primary = Color.red
    let primaryForeground = Color.white
    let background = Color.black
    let foreground = Color.white
    let card = Color.gray
    let muted = Color.gray
    let mutedForeground = Color.secondary
    let accent = Color.orange
    let border = Color.gray
    let destructive = Color.red
}
