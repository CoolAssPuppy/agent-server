import SwiftUI
import AgentServerDesignSystem
import UserNotifications

struct SettingsGeneralSection: View {
    @ObservedObject var monitor: StatusMonitor
    @Binding var launchAtLogin: Bool
    @Binding var resumeAfterWake: Bool
    let requiresRestart: Bool
    let onRestart: () -> Void

    var body: some View {
        SettingsGroup(
            title: SettingsSection.general.title,
            titleContextActionLabel: monitor.demoModeState.contextMenuTitle,
            onTitleContextAction: monitor.toggleDemoMode
        ) {
            SettingsToggleRow(
                label: "Launch at login",
                description: "Start Agent Server when you log in.",
                isOn: $launchAtLogin
            )
                .onChange(of: launchAtLogin) { _, value in
                    LaunchAtLoginManager.shared.isEnabled = value
                    Telemetry.capture(.settingChanged, properties: [
                        "setting": "launch_at_login",
                        "enabled": value,
                    ])
                }
            SettingsRowDivider()
            SettingsToggleRow(
                label: "Resume scheduled assistants after wake",
                description: "Run work missed while this Mac was asleep.",
                isOn: $resumeAfterWake
            )
                .onChange(of: resumeAfterWake) { _, value in
                    Telemetry.capture(.settingChanged, properties: [
                        "setting": "resume_after_wake",
                        "enabled": value,
                    ])
                }
            if requiresRestart {
                SettingsRestartNotice(action: onRestart)
                    .padding(.top, 8)
            }
            SettingsRowDivider()
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

struct SettingsDeviceSection: View {
    let presentation: CurrentDevicePresentation?

    @AppStorage("device.displayName") private var deviceName = "This Mac"

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsGroup(title: SettingsSection.device.title) {
            if let presentation {
                SettingsValueRow(label: "Name") {
                    TextField("Device name", text: $deviceName)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 150)
                        .onSubmit {
                            deviceName = CurrentDevicePresentation.normalizedName(deviceName)
                        }
                        .accessibilityIdentifier("settings.device.name")
                }
                SettingsRowDivider()
                SettingsValueRow(label: "Status") {
                    SettingsStatusPill(
                        isHealthy: presentation.isServerReachable,
                        label: presentation.status
                    )
                }
                SettingsRowDivider()
                SettingsValueRow(label: "Assistants") {
                    Text(presentation.assistantCountText)
                        .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                SettingsRowDivider()
                SettingsValueRow(label: "Last heard from") {
                    if let lastHeardAt = presentation.lastHeardAt {
                        Text(lastHeardAt, style: .relative)
                            .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    } else {
                        Text(presentation.lastHeardText)
                            .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
                DisclosureGroup("Technical details") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(presentation.serverVersionText)
                        Text(presentation.protocolText)
                        Text(presentation.machineID)
                            .textSelection(.enabled)
                    }
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize), design: .monospaced))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.top, 6)
                }
                .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                .accessibilityIdentifier("settings.device.technicalDetails")
            } else {
                Text("Device details will appear when the local server responds.")
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .accessibilityIdentifier("settings.device")
        .onAppear {
            deviceName = CurrentDevicePresentation.normalizedName(deviceName)
        }
    }
}

struct SettingsAppearanceSection: View {
    @ObservedObject private var themeManager = ThemeManager.shared

    var body: some View {
        SettingsGroup(title: SettingsSection.appearance.title) {
            SettingsValueRow(label: "Theme") {
                Picker("Theme", selection: $themeManager.currentTheme) {
                    ForEach(AgentServerThemeId.allCases) { appTheme in
                        Text(appTheme.displayName).tag(appTheme)
                    }
                }
                .labelsHidden()
                .frame(width: 150)
                .accessibilityIdentifier("settings.appearance.theme")
            }
        }
    }
}

struct SettingsTelemetrySection: View {
    @Binding var telemetryOptIn: Bool

    var body: some View {
        SettingsGroup(title: SettingsSection.telemetry.title) {
            SettingsToggleRow(
                label: "Help improve Agent Server",
                description: "Send anonymous usage data.",
                isOn: $telemetryOptIn
            )
            .onChange(of: telemetryOptIn) { _, value in
                if !value {
                    Telemetry.capture(.settingChanged, properties: [
                        "setting": "telemetry_opt_in",
                        "enabled": false,
                    ])
                }
                Telemetry.setOptedIn(value)
                if value {
                    Telemetry.capture(.settingChanged, properties: [
                        "setting": "telemetry_opt_in",
                        "enabled": true,
                    ])
                }
            }
        }
    }
}

struct SettingsSecuritySection: View {
    let onOpen: () -> Void

    var body: some View {
        SettingsGroup(title: SettingsSection.security.title) {
            SettingsFullWidthActionButton(
                title: "Review assistant access and safety…",
                action: onOpen
            )
            .accessibilityIdentifier("settings.openSecurity")
        }
    }
}

struct SettingsRuntimeSection: View {
    @Binding var usesInstalledKimi: Bool
    let requiresRestart: Bool
    let onRestart: () -> Void

    var body: some View {
        SettingsGroup(title: SettingsSection.runtimes.title) {
            SettingsToggleRow(label: "Use installed Kimi", isOn: $usesInstalledKimi)
                .onChange(of: usesInstalledKimi) { _, value in
                    Telemetry.capture(.settingChanged, properties: [
                        "setting": "use_installed_kimi",
                        "enabled": value,
                    ])
                }
            if requiresRestart {
                SettingsRestartNotice(action: onRestart)
                    .padding(.top, 10)
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
            VStack(alignment: .leading, spacing: 8) {
                Text("Your assistants and private connection settings live here.")
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(theme.tokens.mutedForeground)
                Text(workspace.homeDirectory.path)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            HStack(spacing: 8) {
                SettingsSecondaryButton(title: "Choose…", action: onChoose)
                    .accessibilityIdentifier("settings.chooseAgentServerFolder")
                SettingsSecondaryButton(title: "Open in Finder", action: onOpen)
                if workspace != .default() {
                    SettingsSecondaryButton(title: "Use default", action: onRestoreDefault)
                }
            }
            .padding(.top, 12)
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
                SettingsRowDivider()
                SettingsToggleRow(
                    label: "Notify for assistant output",
                    isOn: $preferences.includeAgentOutput
                )
            }
            if isAuthorizationDenied {
                Text("Notifications are blocked in System Settings. Enable them under Notifications > Agent Server.")
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
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
            SettingsRowDivider()
            SettingsValueRow(label: "Current version") {
                Text(version)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }
            SettingsRowDivider()
            SettingsFullWidthActionButton(
                title: "Check for updates…",
                action: updater.checkForUpdates
            )
        }
    }

    private var version: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}
