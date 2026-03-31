import SwiftUI

struct SettingsTabView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject private var launchManager = LaunchAtLoginManager.shared
    @State private var catchUpEnabled: Bool = {
        let env = EnvFile.load()
        return env.entries.first(where: { $0.key == "AGENT_SERVER_CATCH_UP" })?.value == "true"
    }()
    @State private var serverLocation: String = ServerProcessManager.configuredLocation() ?? ""

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("General") {
                    Toggle("Launch at login", isOn: $launchManager.isEnabled)

                    Toggle("Resume scheduled Agents after wake", isOn: $catchUpEnabled)
                        .onChange(of: catchUpEnabled) { _, newValue in
                            updateCatchUpSetting(newValue)
                        }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Server location")
                        HStack(spacing: 8) {
                            if serverLocation.isEmpty {
                                Text("Not configured (auto-detect)")
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                            } else {
                                Text(serverLocation)
                                    .font(.system(.caption, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .foregroundStyle(.secondary)
                                    .help(serverLocation)
                            }
                            Spacer()
                            Button("Choose\u{2026}") {
                                chooseServerLocation()
                            }
                            .controlSize(.small)
                            if !serverLocation.isEmpty {
                                Button("Clear") {
                                    serverLocation = ""
                                    ServerProcessManager.setLocation(nil)
                                }
                                .controlSize(.small)
                            }
                        }
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
                    .contextMenu {
                        Button("Restart server") {
                            monitor.requestServerRestart()
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

                Section("Environment variables") {
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

    private func chooseServerLocation() {
        let panel = NSOpenPanel()
        panel.title = "Select agent-server repo folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        let path = url.path
        serverLocation = path
        ServerProcessManager.setLocation(path)
        monitor.requestServerRestart()
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
