import SwiftUI

public protocol AppPalette {
    var id: String { get }
    var displayName: String { get }
    var isDark: Bool { get }
    var primary: Color { get }
    var primaryForeground: Color { get }
    var background: Color { get }
    var foreground: Color { get }
    var card: Color { get }
    var cardForeground: Color { get }
    var muted: Color { get }
    var mutedForeground: Color { get }
    var accent: Color { get }
    var accentForeground: Color { get }
    var border: Color { get }
    var destructive: Color { get }
}

public struct ColorTokens {
    public let primary: Color
    public let primaryForeground: Color
    public let background: Color
    public let foreground: Color
    public let card: Color
    public let cardForeground: Color
    public let muted: Color
    public let mutedForeground: Color
    public let accent: Color
    public let accentForeground: Color
    public let border: Color
    public let destructive: Color
    public let success: Color
    public let warning: Color
    public let error: Color

    public init(palette: any AppPalette) {
        primary = palette.primary
        primaryForeground = palette.primaryForeground
        background = palette.background
        foreground = palette.foreground
        card = palette.card
        cardForeground = palette.cardForeground
        muted = palette.muted
        mutedForeground = palette.mutedForeground
        accent = palette.accent
        accentForeground = palette.accentForeground
        border = palette.border
        destructive = palette.destructive
        success = Color(hex: "#22C55E")
        warning = Color(hex: "#F59E0B")
        error = palette.destructive
    }
}

public struct ThemeConfiguration {
    public let id: String
    public let displayName: String
    public let isDark: Bool
    public let tokens: ColorTokens

    public init(palette: any AppPalette) {
        id = palette.id
        displayName = palette.displayName
        isDark = palette.isDark
        tokens = ColorTokens(palette: palette)
    }
}

private struct DefaultPalette: AppPalette {
    let id = "default"
    let displayName = "Default"
    let isDark = true
    let primary = Color.accentColor
    let primaryForeground = Color.white
    let background = Color(nsColor: .windowBackgroundColor)
    let foreground = Color(nsColor: .labelColor)
    let card = Color(nsColor: .controlBackgroundColor)
    let cardForeground = Color(nsColor: .labelColor)
    let muted = Color(nsColor: .underPageBackgroundColor)
    let mutedForeground = Color(nsColor: .secondaryLabelColor)
    let accent = Color.accentColor
    let accentForeground = Color.white
    let border = Color(nsColor: .separatorColor)
    let destructive = Color.red
}

private struct NThemeKey: EnvironmentKey {
    static let defaultValue = ThemeConfiguration(palette: DefaultPalette())
}

public extension EnvironmentValues {
    var nTheme: ThemeConfiguration {
        get { self[NThemeKey.self] }
        set { self[NThemeKey.self] = newValue }
    }
}

public extension View {
    func nTheme(_ theme: ThemeConfiguration) -> some View {
        environment(\.nTheme, theme)
    }
}
