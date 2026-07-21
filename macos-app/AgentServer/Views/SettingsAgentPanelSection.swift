import SwiftUI
import AgentServerDesignSystem

struct SettingsAgentPanelSection: View {
    let settings: AgentPanelSettings
    @Binding var isSending: Bool
    let connection: AgentPanelConnection
    let requiresRestart: Bool
    @Binding var telemetry: TelemetryProgressSettings
    let onRestart: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.agentPanel.title) {
            SettingsToggleRow(label: "Send data to Agent Panel", isOn: $isSending)
                .disabled(!settings.hasRequiredCredentials)
                .opacity(settings.hasRequiredCredentials ? 1 : 0.45)
            if !settings.hasRequiredCredentials {
                Text("Add both the Agent Panel URL and API key below to turn this on.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            SettingsValueRow(label: "Agent Panel connection") {
                SettingsStatusPill(
                    isHealthy: connection == .connected,
                    label: connection.rawValue
                )
            }
            if requiresRestart { restartNotice }
            progressSettings
        }
    }

    private var restartNotice: some View {
        HStack(spacing: NSpacing.sm) {
            Text("Restart Agent Server to use this change.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer(minLength: NSpacing.xs)
            Button("Restart now", action: onRestart)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
    }

    @ViewBuilder
    private var progressSettings: some View {
        Divider().padding(.vertical, NSpacing.xs)
        Text("Progress reporting")
            .font(NTypography.labelMedium)
            .foregroundStyle(theme.tokens.foreground)
        SettingsValueRow(label: "Progress mode") {
            Picker("Progress mode", selection: $telemetry.mode) {
                Text("Live").tag(TelemetryProgressMode.live)
                Text("Batched").tag(TelemetryProgressMode.batched)
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 140)
        }
        SettingsValueRow(label: "Sample interval (s)") {
            Stepper(value: $telemetry.sampleSeconds, in: 1...600) {
                monospacedValue(telemetry.sampleSeconds)
            }
            .controlSize(.mini)
        }
        SettingsValueRow(label: "Max progress entries") {
            Stepper(value: $telemetry.maxEntries, in: 1...500) {
                monospacedValue(telemetry.maxEntries)
            }
            .controlSize(.mini)
        }
        SettingsToggleRow(
            label: "Include progress metadata",
            isOn: $telemetry.includesMetadata
        )
        Text("Per-agent settings override these values. Restart the server to apply changes.")
            .font(NTypography.captionSmall)
            .foregroundStyle(theme.tokens.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func monospacedValue(_ value: Int) -> some View {
        Text("\(value)")
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(theme.tokens.foreground)
    }
}
