import SwiftUI
import NerdsUI

struct SettingsCard<Content: View>: View {
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
        VStack(alignment: .leading, spacing: NSpacing.md) {
            Text(title)
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)
                .contextMenu {
                    if let titleContextActionLabel, let onTitleContextAction {
                        Button(titleContextActionLabel, action: onTitleContextAction)
                    }
                }
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct SettingsToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack {
            Text(label)
                .font(NTypography.bodyLarge)
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
                .font(NTypography.bodyLarge)
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
                .font(NTypography.captionSmall)
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
                        .font(NTypography.bodyLarge)
                    Text("Agent Panel and environment values")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                Spacer()
            }
            .foregroundStyle(theme.tokens.foreground)
            .padding(.vertical, NSpacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.advanced")
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    }
}
