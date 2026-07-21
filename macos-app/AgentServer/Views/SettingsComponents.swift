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
        VStack(alignment: .leading, spacing: NSpacing.sm) {
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
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
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
    @Binding var isOn: Bool

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack {
            Text(label)
                .font(.system(
                    size: CGFloat(SettingsPresentation.rowTitleFontSize),
                    weight: .medium
                ))
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Toggle(label, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.vertical, 4)
    }
}

struct SettingsValueRow<Trailing: View>: View {
    let label: String
    @ViewBuilder let trailing: () -> Trailing

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack {
            Text(label)
                .font(.system(
                    size: CGFloat(SettingsPresentation.rowTitleFontSize),
                    weight: .medium
                ))
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            trailing()
        }
        .padding(.vertical, 4)
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
                .font(NTypography.bodyMedium)
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
            Button("Restart now", action: action)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
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
                    Text("Agent Panel and environment values")
                        .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                Spacer()
            }
            .foregroundStyle(theme.tokens.foreground)
            .padding(.vertical, NSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.advanced")
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    }
}
