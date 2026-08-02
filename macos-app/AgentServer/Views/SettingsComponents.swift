import SwiftUI
import AgentServerDesignSystem

struct SettingsGroup<Content: View>: View {
    let title: String
    let titleContextActionLabel: String?
    let onTitleContextAction: (() -> Void)?
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    init(
        title: String,
        titleContextActionLabel: String? = nil,
        onTitleContextAction: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.titleContextActionLabel = titleContextActionLabel
        self.onTitleContextAction = onTitleContextAction
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if titleInteraction.allowsTextSelection {
                    Text(displayTitle).textSelection(.enabled)
                } else {
                    Text(displayTitle).textSelection(.disabled)
                }
            }
                .font(.system(
                    size: CGFloat(SettingsPresentation.cardHeadingFontSize),
                    weight: .semibold
                ))
                .tracking(SettingsPresentation.cardHeadingTracking)
                .foregroundStyle(theme.tokens.mutedForeground)
                .contextMenu {
                    if let titleContextActionLabel, let onTitleContextAction {
                        Button(titleContextActionLabel, action: onTitleContextAction)
                    }
                }
                .padding(.bottom, CGFloat(SettingsPresentation.cardHeadingBottomPadding))
            VStack(alignment: .leading, spacing: 0) {
                content()
            }
        }
        .padding(.horizontal, CGFloat(SettingsPresentation.cardHorizontalPadding))
        .padding(.vertical, CGFloat(SettingsPresentation.cardVerticalPadding))
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.tokens.card)
        .overlay {
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.border, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    private var titleInteraction: SettingsGroupTitleInteraction {
        SettingsGroupTitleInteraction(hasContextAction: onTitleContextAction != nil)
    }

    private var displayTitle: String {
        SettingsPresentation.usesUppercaseCardHeadings ? title.uppercased() : title
    }
}

struct SettingsToggleRow: View {
    let label: String
    var description: String? = nil
    @Binding var isOn: Bool

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsValueRow(label: label, description: description) {
            Toggle(label, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
                .tint(theme.tokens.primary)
        }
    }
}

struct SettingsValueRow<Trailing: View>: View {
    let label: String
    var description: String? = nil
    @ViewBuilder let trailing: () -> Trailing

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(
            alignment: .center,
            spacing: CGFloat(SettingsPresentation.rowHorizontalSpacing)
        ) {
            VStack(alignment: .leading, spacing: CGFloat(SettingsPresentation.rowTextSpacing)) {
                Text(label)
                    .font(.system(
                        size: CGFloat(SettingsPresentation.rowTitleFontSize),
                        weight: .medium
                    ))
                    .foregroundStyle(theme.tokens.foreground)
                if let description {
                    Text(description)
                        .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
    }
}

struct SettingsRowDivider: View {
    @Environment(\.nTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.tokens.border.opacity(0.65))
            .frame(height: 1)
            .padding(.vertical, CGFloat(SettingsPresentation.rowDividerVerticalPadding))
    }
}

struct SettingsStatusPill: View {
    let isHealthy: Bool
    let label: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.xxs) {
            Image(systemName: isHealthy ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(isHealthy ? Color.green : Color.orange)
                .accessibilityHidden(true)
            Text(label)
                .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                .foregroundStyle(theme.tokens.foreground)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SettingsRestartNotice: View {
    let action: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: NSpacing.sm) {
            Text("Restart Agent Server to use this change.")
                .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer(minLength: NSpacing.xs)
            SettingsSecondaryButton(title: "Restart now", action: action)
        }
    }
}

struct SettingsAdvancedDisclosure: View {
    @Binding var isExpanded: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nTheme) private var theme

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) {
                isExpanded.toggle()
            }
        } label: {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Advanced")
                        .font(.system(
                            size: CGFloat(SettingsPresentation.rowTitleFontSize),
                            weight: .medium
                        ))
                    Text("AI engine, local server, telemetry, environment, and security")
                        .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                Spacer()
            }
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, CGFloat(SettingsPresentation.cardHorizontalPadding))
            .padding(.vertical, 12)
            .background(theme.tokens.card)
            .overlay {
                RoundedRectangle(cornerRadius: NRadius.md)
                    .stroke(theme.tokens.border, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.advanced")
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    }
}
