import SwiftUI
import NerdsUI
import UserNotifications

struct SettingsTabView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject private var notificationPreferences = NotificationPreferences.shared
    @ObservedObject private var launchManager = LaunchAtLoginManager.shared
    @ObservedObject private var updater = UpdaterManager.shared
    @AppStorage("catchUpEnabled") private var catchUpEnabled = false
    @State private var serverLocation: String = ServerProcessManager.configuredLocation() ?? ""
    @State private var notificationsAuthorizationDenied: Bool = false

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("General") {
                    Toggle("Launch at login", isOn: $launchManager.isEnabled)

                    Toggle("Resume scheduled Agents after wake", isOn: $catchUpEnabled)
                        .onChange(of: catchUpEnabled) { _, newValue in
                            updateCatchUpSetting(newValue)
                        }

                    VStack(alignment: .leading, spacing: NSpacing.xs) {
                        HStack(spacing: NSpacing.sm) {
                            Text("Server location")
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
                        if serverLocation.isEmpty {
                            Text("Built-in server detected")
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .font(NTypography.caption)
                        } else {
                            Text(serverLocation)
                                .font(.system(size: 11, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .help(serverLocation)
                        }
                    }

                    HStack {
                        Text("Server status")
                        Spacer()
                        HStack(spacing: NSpacing.xs) {
                            Image(systemName: monitor.isServerReachable
                                  ? "checkmark.circle.fill"
                                  : "xmark.circle.fill")
                                .foregroundStyle(monitor.isServerReachable ? .green : .red)
                            Text(monitor.isServerReachable ? "Running" : "Offline")
                                .foregroundStyle(theme.tokens.mutedForeground)
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
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .monospacedDigit()
                        }
                    }
                }

                Section("Notifications") {
                    Toggle("Enable notifications", isOn: $notificationPreferences.enabled)

                    if notificationPreferences.enabled {
                        Toggle("Notify for agent output", isOn: $notificationPreferences.includeAgentOutput)
                    }

                    if notificationsAuthorizationDenied {
                        Text("Notifications are blocked in System Settings. Enable them under Notifications > Agent Server.")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }

                Section("Updates") {
                    Toggle("Automatically check for updates", isOn: $updater.automaticallyChecksForUpdates)

                    HStack {
                        Text("Current version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0")
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .monospacedDigit()
                    }

                    HStack {
                        Spacer()
                        Button("Check for Updates\u{2026}") {
                            updater.checkForUpdates()
                        }
                        .controlSize(.small)
                        .disabled(!updater.canCheckForUpdates)
                    }
                }

                Section("Environment variables") {
                    EnvEditorView()
                }
            }
            .formStyle(.grouped)
            .task {
                await refreshNotificationAuthorizationStatus()
            }

            Spacer(minLength: NSpacing.lg)

            Divider().opacity(0.3).padding(.horizontal, NSpacing.xxl)

            VStack(spacing: NSpacing.xxxs) {
                Text("\u{00A9} 2026 Strategic Nerds, Inc.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground.opacity(0.6))
                Text("Made with love in Lisbon, Portugal")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground.opacity(0.6))
                Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground.opacity(0.4))

                Link("Like Agent Server? Buy me coffee on Venmo: @coolasspuppy",
                     destination: URL(string: "https://venmo.com/coolasspuppy")!)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
                    .padding(.top, NSpacing.xs)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, NSpacing.md)
        }
    }

    private func chooseServerLocation() {
        let panel = NSOpenPanel()
        panel.title = "Select agent-server repo folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let url = panel.url else { return }
        let path = url.path
        serverLocation = path
        ServerProcessManager.setLocation(path)
        monitor.requestServerRestart()
    }

    private func refreshNotificationAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        await MainActor.run {
            notificationsAuthorizationDenied = settings.authorizationStatus == .denied
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
