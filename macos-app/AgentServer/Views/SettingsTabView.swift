import SwiftUI

struct SettingsTabView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject private var launchManager = LaunchAtLoginManager.shared
    @State private var catchUpEnabled: Bool = {
        let env = EnvFile.load()
        return env.entries.first(where: { $0.key == "AGENT_SERVER_CATCH_UP" })?.value == "true"
    }()

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("General") {
                    Toggle("Launch at login", isOn: $launchManager.isEnabled)

                    Toggle("Resume missed schedules after sleep", isOn: $catchUpEnabled)
                        .onChange(of: catchUpEnabled) { _, newValue in
                            updateCatchUpSetting(newValue)
                        }

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
                Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")")
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 12)
        }
    }

    private func updateCatchUpSetting(_ enabled: Bool) {
        var env = EnvFile.load()
        if let index = env.entries.firstIndex(where: { $0.key == "AGENT_SERVER_CATCH_UP" }) {
            env.entries[index] = EnvEntry(key: "AGENT_SERVER_CATCH_UP", value: enabled ? "true" : "false", isComment: false)
        } else {
            env.entries.append(EnvEntry(key: "AGENT_SERVER_CATCH_UP", value: enabled ? "true" : "false", isComment: false))
        }
        try? env.save()
    }
}
