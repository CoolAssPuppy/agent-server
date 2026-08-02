import SwiftUI
import AgentServerDesignSystem

struct SettingsAgentPanelSection: View {
    @Binding var isSending: Bool
    let connection: AgentPanelConnection
    let requiresRestart: Bool
    @Binding var telemetry: TelemetryProgressSettings
    let onRestart: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.agentPanel.title) {
            SettingsToggleRow(label: "Send data to Agent Panel", isOn: $isSending)
                .disabled(!hasRequiredCredentials)
                .opacity(hasRequiredCredentials ? 1 : 0.45)
            if !hasRequiredCredentials {
                Text("Add both the Agent Panel URL and API key below to turn this on.")
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
            }
            SettingsRowDivider()
            SettingsValueRow(label: "Agent Panel connection") {
                Text(connection.rawValue)
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(
                        connection == .unavailable
                            ? theme.tokens.warning
                            : theme.tokens.foreground
                    )
            }
            if requiresRestart {
                SettingsRestartNotice(action: onRestart)
                    .padding(.top, 8)
            }
            progressSettings
        }
    }

    @ViewBuilder
    private var progressSettings: some View {
        SettingsRowDivider()
        Text("Progress reporting")
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(theme.tokens.mutedForeground)
            .textCase(.uppercase)
            .padding(.bottom, 10)
        SettingsValueRow(label: "Progress mode") {
            Picker("Progress mode", selection: telemetryMode) {
                Text("Live").tag(TelemetryProgressMode.live)
                Text("Batched").tag(TelemetryProgressMode.batched)
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .controlSize(.small)
            .frame(width: 140)
        }
        SettingsRowDivider()
        SettingsValueRow(label: "Sample interval (s)") {
            Stepper(value: telemetrySampleSeconds, in: 1...600) {
                monospacedValue(telemetry.sampleSeconds)
            }
            .controlSize(.small)
        }
        SettingsRowDivider()
        SettingsValueRow(label: "Max progress entries") {
            Stepper(value: telemetryMaxEntries, in: 1...500) {
                monospacedValue(telemetry.maxEntries)
            }
            .controlSize(.small)
        }
        SettingsRowDivider()
        SettingsToggleRow(
            label: "Include progress metadata",
            isOn: telemetryIncludesMetadata
        )
        Text("Per-agent settings override these values. Restart the server to apply changes.")
            .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
            .foregroundStyle(theme.tokens.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 8)
    }

    private func monospacedValue(_ value: Int) -> some View {
        Text("\(value)")
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(theme.tokens.foreground)
    }

    private var hasRequiredCredentials: Bool {
        connection.hasRequiredCredentials
    }

    private var telemetryMode: Binding<TelemetryProgressMode> {
        telemetryBinding(\.mode) { settings, mode in
            settings.updating(mode: mode)
        }
    }

    private var telemetrySampleSeconds: Binding<Int> {
        telemetryBinding(\.sampleSeconds) { settings, sampleSeconds in
            settings.updating(sampleSeconds: sampleSeconds)
        }
    }

    private var telemetryMaxEntries: Binding<Int> {
        telemetryBinding(\.maxEntries) { settings, maxEntries in
            settings.updating(maxEntries: maxEntries)
        }
    }

    private var telemetryIncludesMetadata: Binding<Bool> {
        telemetryBinding(\.includesMetadata) { settings, includesMetadata in
            settings.updating(includesMetadata: includesMetadata)
        }
    }

    private func telemetryBinding<Value>(
        _ keyPath: KeyPath<TelemetryProgressSettings, Value>,
        updating update: @escaping (TelemetryProgressSettings, Value) -> TelemetryProgressSettings
    ) -> Binding<Value> {
        Binding(
            get: { telemetry[keyPath: keyPath] },
            set: { telemetry = update(telemetry, $0) }
        )
    }
}
