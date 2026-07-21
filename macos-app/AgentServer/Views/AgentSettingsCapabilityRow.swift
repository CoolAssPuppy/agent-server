import AgentServerDesignSystem
import SwiftUI

struct AgentSettingsCapabilityRow: View {
    let capability: AgentCapability
    let isEnabled: Bool
    let onToggle: (Bool) -> Void
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(
                capability: capability,
                size: 18,
                tint: isEnabled ? theme.tokens.foreground : theme.tokens.mutedForeground.opacity(0.6)
            )
            .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: NSpacing.xs) {
                    Text(capability.label)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    if capability.custom {
                        Text("Custom")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
                Text(capability.description)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(2)
                if needsConnection && !isEnabled {
                    Text("Needs to be connected first")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.primary)
                }
                if capability.status == "needs-auth" {
                    Text("Sign in from Claude to use this")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.warning)
                }
            }
            Spacer()
            control
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.sm)
    }

    @ViewBuilder private var control: some View {
        if needsConnection && !isEnabled {
            Button("Connect…") { onToggle(true) }
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        } else {
            Toggle("", isOn: Binding(get: { isEnabled }, set: onToggle))
                .toggleStyle(.switch)
                .controlSize(.small)
                .labelsHidden()
                .accessibilityLabel("Allow \(capability.label)")
                .accessibilityValue(isEnabled ? "On" : "Off")
        }
    }

    private var needsConnection: Bool {
        !capability.envReady && !capability.requiredEnv.isEmpty
    }
}
