import SwiftUI

struct SettingsTabView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject private var launchManager = LaunchAtLoginManager.shared

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("General") {
                    Toggle("Launch at login", isOn: $launchManager.isEnabled)

                    HStack {
                        Text("Server status")
                        Spacer()
                        HStack(spacing: 6) {
                            Image(systemName: monitor.isServerReachable
                                  ? "checkmark.circle.fill"
                                  : "xmark.circle.fill")
                                .foregroundStyle(monitor.isServerReachable ? .green : .red)
                                .font(.body)
                            Text(monitor.isServerReachable ? "Running" : "Offline")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if monitor.isServerReachable {
                        HStack {
                            Text("Agents loaded")
                            Spacer()
                            Text("\(monitor.agents.count)")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                }

                Section("Environment") {
                    EnvEditorView()
                }
            }
            .formStyle(.grouped)

            Spacer(minLength: 0)

            VStack(spacing: 2) {
                Text("\u{00A9} 2026 Strategic Nerds, Inc.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text("Made with \u{2764}\u{FE0F} in Lisbon, Portugal")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 12)
        }
    }
}
