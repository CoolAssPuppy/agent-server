import SwiftUI
import AgentServerDesignSystem

struct SettingsSecondaryButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(
                            size: CGFloat(SettingsPresentation.secondaryButtonFontSize),
                            weight: .medium
                        ))
                }
                Text(title)
                    .font(.system(
                        size: CGFloat(SettingsPresentation.secondaryButtonFontSize),
                        weight: .medium
                    ))
            }
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, CGFloat(SettingsPresentation.secondaryButtonHorizontalPadding))
            .padding(.vertical, CGFloat(SettingsPresentation.secondaryButtonVerticalPadding))
            .background(buttonBackground)
            .overlay(buttonBorder)
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .onHover { isHovered = $0 }
    }

    private var buttonBackground: some View {
        RoundedRectangle(
            cornerRadius: CGFloat(SettingsPresentation.secondaryButtonCornerRadius),
            style: .continuous
        )
        .fill(isHovered ? theme.tokens.muted : theme.tokens.background)
    }

    private var buttonBorder: some View {
        RoundedRectangle(
            cornerRadius: CGFloat(SettingsPresentation.secondaryButtonCornerRadius),
            style: .continuous
        )
        .stroke(isFocused ? theme.tokens.primary : theme.tokens.border, lineWidth: isFocused ? 2 : 1)
    }
}

struct SettingsFullWidthActionButton: View {
    let title: String
    let action: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(theme.tokens.foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isHovered ? theme.tokens.muted : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(
                            isFocused ? theme.tokens.primary : theme.tokens.border,
                            lineWidth: isFocused ? 2 : 1
                        )
                )
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .onHover { isHovered = $0 }
    }
}

struct SettingsIconButton: View {
    let systemName: String
    let help: String
    var isDisabled = false
    let action: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(
                    size: CGFloat(SettingsPresentation.iconButtonFontSize),
                    weight: .medium
                ))
                .foregroundStyle(
                    isDisabled
                        ? theme.tokens.mutedForeground.opacity(0.5)
                        : theme.tokens.foreground
                )
                .frame(
                    width: CGFloat(SettingsPresentation.iconButtonWidth),
                    height: CGFloat(SettingsPresentation.iconButtonHeight)
                )
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isHovered ? theme.tokens.muted : theme.tokens.background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(
                            isFocused ? theme.tokens.primary : theme.tokens.border,
                            lineWidth: isFocused ? 2 : 1
                        )
                )
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .disabled(isDisabled)
        .onHover { isHovered = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}
