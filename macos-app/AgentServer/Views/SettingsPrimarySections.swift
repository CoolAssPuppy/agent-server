import SwiftUI
import AgentServerDesignSystem
import UserNotifications

struct SettingsGeneralSection: View {
    @ObservedObject var monitor: StatusMonitor
    @Binding var launchAtLogin: Bool
    @Binding var resumeAfterWake: Bool
    let requiresRestart: Bool
    @Binding var telemetryOptIn: Bool
    let onRestart: () -> Void

    var body: some View {
        SettingsGroup(
            title: SettingsSection.general.title,
            titleContextActionLabel: monitor.demoModeState.contextMenuTitle,
            onTitleContextAction: monitor.toggleDemoMode
        ) {
            SettingsToggleRow(label: "Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, value in
                    LaunchAtLoginManager.shared.isEnabled = value
                }
            SettingsToggleRow(
                label: "Resume scheduled agents after wake",
                isOn: $resumeAfterWake
            )
            if requiresRestart { SettingsRestartNotice(action: onRestart) }
            SettingsToggleRow(label: "Help improve Agent Server", isOn: $telemetryOptIn)
                .onChange(of: telemetryOptIn) { _, value in Telemetry.setOptedIn(value) }
            SettingsValueRow(label: "Server status") {
                SettingsStatusPill(
                    isHealthy: monitor.isServerReachable,
                    label: monitor.isServerReachable ? "Running" : "Offline"
                )
                .contextMenu {
                    Button("Restart Agent Server", action: monitor.requestServerRestart)
                }
            }
        }
    }
}

struct SettingsRuntimeSection: View {
    @Binding var usesInstalledClaude: Bool
    @Binding var usesInstalledCodex: Bool
    @Binding var usesInstalledKimi: Bool
    let requiresRestart: Bool
    let onRestart: () -> Void

    var body: some View {
        SettingsGroup(title: SettingsSection.runtimes.title) {
            SettingsToggleRow(label: "Use installed Claude", isOn: $usesInstalledClaude)
            SettingsToggleRow(label: "Use installed Codex", isOn: $usesInstalledCodex)
            SettingsToggleRow(label: "Use installed Kimi", isOn: $usesInstalledKimi)
            if requiresRestart {
                SettingsRestartNotice(action: onRestart)
                    .accessibilityIdentifier("settings.restartRuntime")
            }
        }
    }
}

struct SettingsStorageSection: View {
    let workspace: AgentServerWorkspace
    let onChoose: () -> Void
    let onOpen: () -> Void
    let onRestoreDefault: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.storage.title) {
            Text("Your agents and private connection settings live here.")
                .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(workspace.homeDirectory.path)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
            HStack(spacing: NSpacing.sm) {
                Button("Choose…", action: onChoose)
                    .accessibilityIdentifier("settings.chooseAgentServerFolder")
                Button("Open in Finder", action: onOpen)
                if workspace != .default() {
                    Button("Use default", action: onRestoreDefault)
                }
            }
            .controlSize(.small)
        }
    }
}

struct SettingsNotificationsSection: View {
    @ObservedObject private var preferences = NotificationPreferences.shared
    @State private var isAuthorizationDenied = false
    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.notifications.title) {
            SettingsToggleRow(label: "Enable notifications", isOn: $preferences.enabled)
            if preferences.enabled {
                SettingsToggleRow(
                    label: "Notify for agent output",
                    isOn: $preferences.includeAgentOutput
                )
            }
            if isAuthorizationDenied {
                Text("Notifications are blocked in System Settings. Enable them under Notifications > Agent Server.")
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            isAuthorizationDenied = settings.authorizationStatus == .denied
        }
    }
}

struct SettingsUpdatesSection: View {
    @ObservedObject private var updater = UpdaterManager.shared
    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.updates.title) {
            SettingsToggleRow(
                label: "Automatically check for updates",
                isOn: $updater.automaticallyChecksForUpdates
            )
            SettingsValueRow(label: "Current version") {
                Text(version)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }
            Button("Check for updates…", action: updater.checkForUpdates)
                .controlSize(.small)
        }
    }

    private var version: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}
