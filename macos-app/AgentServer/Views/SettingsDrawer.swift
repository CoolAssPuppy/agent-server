import SwiftUI
import NerdsUI
import AppKit
import UserNotifications

/// Settings drawer that pulls down over the main pane. Everyday controls lead
/// in a flat, single-column form. Infrastructure controls stay behind Advanced,
/// and the whole surface scrolls when the window is short.
///
/// Visual rules:
///  - Overlay, not push. The drawer layers on top of the content; the main
///    pane stays put. The host is responsible for dimming the content behind.
///  - Inset from the window chrome (`NSpacing.xxl` on left and right).
///  - Rounded bottom corners only.
///  - Sections share the drawer surface instead of introducing nested cards.
///  - Close affordance pinned upper-right of the drawer inside a muted circle.
struct SettingsDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme
    @State private var pairs: [EnvPair] = []
    @State private var revealedKeys: Set<String> = []
    @State private var editingKey: String? = nil
    @State private var invalidKeys: Set<String> = []
    @State private var saveError: String? = nil
    @State private var selectedIndex: Int? = nil
    @State private var launchAtLogin: Bool = LaunchAtLoginManager.shared.isEnabled
    @State private var resumeAfterWake: Bool = true
    @State private var savedResumeAfterWake: Bool = true
    @State private var useInstalledClaude: Bool = true
    @State private var useInstalledCodex: Bool = true
    @State private var savedRuntimeSelection = RuntimeSelection(
        usesInstalledClaude: true,
        usesInstalledCodex: true
    )
    @State private var workspace = AgentServerWorkspaceStore.current()
    @State private var telemetryOptIn: Bool = Telemetry.isOptedIn
    @State private var didLoad: Bool = false
    @State private var notificationsAuthorizationDenied: Bool = false
    @ObservedObject private var notificationPreferences = NotificationPreferences.shared
    @ObservedObject private var updater = UpdaterManager.shared

    private let catchUpPreference = EnvironmentBooleanPreference(
        key: "AGENT_SERVER_CATCH_UP",
        defaultValue: true
    )

    // MARK: - Telemetry state

    @State private var telemetryMode: TelemetryMode = .live
    @State private var telemetrySampleSeconds: Int = 5
    @State private var telemetryMaxEntries: Int = 50
    @State private var telemetryIncludeMetadata: Bool = false
    @State private var showAdvancedSettings: Bool = false
    @State private var hasPendingPanelRestart: Bool = false

    private var envPath: URL { workspace.environmentFile }

    var body: some View {
        TopDrawerSurface(
            title: "Settings",
            closeLabel: "Close settings",
            onClose: router.close,
            showsDivider: false
        ) {
            content
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            loadPairs()
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                sectionGroup(SettingsPresentation.primarySections)

                Divider()
                    .opacity(0.3)
                    .padding(.vertical, NSpacing.lg)

                SettingsAdvancedDisclosure(isExpanded: $showAdvancedSettings)

                if showAdvancedSettings {
                    Divider()
                        .opacity(0.3)
                        .padding(.vertical, NSpacing.lg)
                    sectionGroup(SettingsPresentation.advancedSections)
                        .accessibilityIdentifier("settings.advancedContent")
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, NSpacing.xxl)
            .padding(.bottom, NSpacing.xxl)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func sectionGroup(_ sections: [SettingsSection]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(sections.enumerated()), id: \.element) { index, section in
                if index > 0 {
                    Divider()
                        .opacity(0.2)
                        .padding(.vertical, NSpacing.lg)
                }
                card(for: section)
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func card(for section: SettingsSection) -> some View {
        switch section {
        case .general: generalSection
        case .runtimes: runtimeSection
        case .notifications: notificationsSection
        case .storage: storageSection
        case .updates: updatesSection
        case .agentPanel: agentPanelSection
        case .environment: environmentSection
        }
    }

    private var generalSection: some View {
        SettingsCard(
            title: SettingsSection.general.title,
            titleContextActionLabel: monitor.demoModeState.contextMenuTitle,
            onTitleContextAction: monitor.toggleDemoMode
        ) {
            SettingsToggleRow(label: "Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, newValue in
                    LaunchAtLoginManager.shared.isEnabled = newValue
                }

            SettingsToggleRow(label: "Resume scheduled agents after wake", isOn: $resumeAfterWake)
                .onChange(of: resumeAfterWake) { _, newValue in
                    pairs = catchUpPreference.updating(pairs, to: newValue)
                    persistIfValid()
                }

            if resumeAfterWake != savedResumeAfterWake {
                SettingsRestartNotice(action: restartForGeneralChange)
            }

            SettingsToggleRow(label: "Help improve Agent Server", isOn: $telemetryOptIn)
                .onChange(of: telemetryOptIn) { _, newValue in
                    Telemetry.setOptedIn(newValue)
                }

            SettingsValueRow(label: "Server status") {
                SettingsStatusPill(
                    isHealthy: monitor.isServerReachable,
                    label: monitor.isServerReachable ? "Running" : "Offline"
                )
                .contextMenu {
                    Button("Restart Agent Server") {
                        monitor.requestServerRestart()
                    }
                }
            }

        }
    }

    private var runtimeSection: some View {
        SettingsCard(title: SettingsSection.runtimes.title) {
            Text("Use the versions already installed on this Mac.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            SettingsToggleRow(label: "Use installed Claude", isOn: $useInstalledClaude)
                .onChange(of: useInstalledClaude) { _, newValue in
                    persistRuntimeFlag(RuntimeEnvKey.useInstalledClaude, useInstalled: newValue)
                }

            SettingsToggleRow(label: "Use installed Codex", isOn: $useInstalledCodex)
                .onChange(of: useInstalledCodex) { _, newValue in
                    persistRuntimeFlag(RuntimeEnvKey.useInstalledCodex, useInstalled: newValue)
                }

            if currentRuntimeSelection.requiresRestart(comparedTo: savedRuntimeSelection) {
                SettingsRestartNotice(action: restartForRuntimeChange)
                    .accessibilityIdentifier("settings.restartRuntime")
            }
        }
    }

    private var storageSection: some View {
        SettingsCard(title: SettingsSection.storage.title) {
            Text("Your agents and private connection settings live here.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            Text(workspace.homeDirectory.path)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)

            HStack(spacing: NSpacing.sm) {
                Button("Choose…", action: chooseWorkspace)
                    .accessibilityIdentifier("settings.chooseAgentServerFolder")
                Button("Open in Finder", action: openWorkspace)
                if workspace != .default() {
                    Button("Use default", action: restoreDefaultWorkspace)
                }
            }
            .controlSize(.small)
        }
    }

    private var environmentSection: some View {
        EnvironmentSettingsCard(
            pairs: $pairs,
            revealedKeys: $revealedKeys,
            editingKey: $editingKey,
            invalidKeys: $invalidKeys,
            selectedIndex: $selectedIndex,
            saveError: saveError,
            onRefreshValidation: refreshValidation,
            onPersist: persistIfValid
        )
    }

    private var agentPanelSection: some View {
        SettingsCard(title: SettingsSection.agentPanel.title) {
            SettingsToggleRow(label: "Send data to Agent Panel", isOn: panelSendingBinding)
                .disabled(!agentPanelSettings.hasRequiredCredentials)
                .opacity(agentPanelSettings.hasRequiredCredentials ? 1 : 0.45)

            if !agentPanelSettings.hasRequiredCredentials {
                Text("Add both the Agent Panel URL and API key below to turn this on.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            SettingsValueRow(label: "Agent Panel connection") {
                SettingsStatusPill(
                    isHealthy: isAgentPanelConnected,
                    label: agentPanelConnectionLabel
                )
            }

            if hasPendingPanelRestart {
                HStack(spacing: NSpacing.sm) {
                    Text("Restart Agent Server to use this change.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Spacer(minLength: NSpacing.xs)
                    Button("Restart now") {
                        hasPendingPanelRestart = false
                        monitor.requestServerRestart()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            }

            panelProgressSettings
        }
    }

    private var notificationsSection: some View {
        SettingsCard(title: SettingsSection.notifications.title) {
            SettingsToggleRow(label: "Enable notifications", isOn: $notificationPreferences.enabled)

            if notificationPreferences.enabled {
                SettingsToggleRow(label: "Notify for agent output", isOn: $notificationPreferences.includeAgentOutput)
            }

            if notificationsAuthorizationDenied {
                Text("Notifications are blocked in System Settings. Enable them under Notifications > Agent Server.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            await MainActor.run {
                notificationsAuthorizationDenied = settings.authorizationStatus == .denied
            }
        }
    }

    /// Agent Panel progress delivery controls. Persists into the selected workspace `.env`.
    /// as the four `AGENT_SERVER_TELEMETRY_PROGRESS_*` keys. Server reads
    /// these on launch, so changes take effect after the next server restart.
    /// Per-agent overrides in agent YAML always win over these values.
    @ViewBuilder
    private var panelProgressSettings: some View {
        Divider()
            .padding(.vertical, NSpacing.xs)

        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text("Progress reporting")
                .font(NTypography.labelMedium)
                .foregroundStyle(theme.tokens.foreground)

            Text("Choose how run progress is sent to Agent Panel.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }

        SettingsValueRow(label: "Progress mode") {
            Picker("Progress mode", selection: $telemetryMode) {
                Text("Live").tag(TelemetryMode.live)
                Text("Batched").tag(TelemetryMode.batched)
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 140)
            .onChange(of: telemetryMode) { _, _ in persistTelemetry() }
        }

        SettingsValueRow(label: "Sample interval (s)") {
            Stepper(value: $telemetrySampleSeconds, in: 1...600) {
                Text("\(telemetrySampleSeconds)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }
            .controlSize(.mini)
            .onChange(of: telemetrySampleSeconds) { _, _ in persistTelemetry() }
        }

        SettingsValueRow(label: "Max progress entries") {
            Stepper(value: $telemetryMaxEntries, in: 1...500) {
                Text("\(telemetryMaxEntries)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }
            .controlSize(.mini)
            .onChange(of: telemetryMaxEntries) { _, _ in persistTelemetry() }
        }

        SettingsToggleRow(label: "Include progress metadata", isOn: $telemetryIncludeMetadata)
            .onChange(of: telemetryIncludeMetadata) { _, _ in persistTelemetry() }

        Text("Per-agent settings override these values. Restart the server to apply changes.")
            .font(NTypography.captionSmall)
            .foregroundStyle(theme.tokens.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var updatesSection: some View {
        SettingsCard(title: SettingsSection.updates.title) {
            SettingsToggleRow(
                label: "Automatically check for updates",
                isOn: $updater.automaticallyChecksForUpdates
            )

            SettingsValueRow(label: "Current version") {
                Text(version)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }

            Button("Check for updates…") {
                UpdaterManager.shared.checkForUpdates()
            }
            .controlSize(.small)
        }
    }

    // MARK: - Derived state

    private var agentPanelSettings: AgentPanelSettings {
        AgentPanelSettings(environment: Dictionary(uniqueKeysWithValues: pairs.map { ($0.key, $0.value) }))
    }

    private var panelSendingBinding: Binding<Bool> {
        Binding(
            get: { agentPanelSettings.isSendingEnabled },
            set: setPanelSendingEnabled
        )
    }

    private var isAgentPanelConnected: Bool {
        agentPanelSettings.hasRequiredCredentials
            && agentPanelSettings.isSendingEnabled
            && monitor.isServerReachable
    }

    private var agentPanelConnectionLabel: String {
        guard agentPanelSettings.hasRequiredCredentials else { return "Not set up" }
        guard agentPanelSettings.isSendingEnabled else { return "Off" }
        return monitor.isServerReachable ? "Connected" : "Reconnecting"
    }

    private var version: String {
        let infoDict = Bundle.main.infoDictionary
        let short = infoDict?["CFBundleShortVersionString"] as? String ?? "0.0"
        let build = infoDict?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }

    // MARK: - Load / save

    private func loadPairs() {
        do {
            pairs = try EnvFileStore.load(from: envPath)
        } catch {
            pairs = []
            saveError = "Could not load \(envPath.lastPathComponent): \(error.localizedDescription)"
        }
        refreshValidation()
        loadTelemetryFromPairs()
        loadRuntimeFromPairs()
        resumeAfterWake = catchUpPreference.value(in: pairs)
        savedResumeAfterWake = resumeAfterWake
    }

    // MARK: - Runtime flag persistence

    private func loadRuntimeFromPairs() {
        let lookup = Dictionary(uniqueKeysWithValues: pairs.map { ($0.key, $0.value) })
        // Absent means the default (on); only an explicit "false" turns it off.
        useInstalledClaude = lookup[RuntimeEnvKey.useInstalledClaude] != "false"
        useInstalledCodex = lookup[RuntimeEnvKey.useInstalledCodex] != "false"
        savedRuntimeSelection = currentRuntimeSelection
    }

    /// Persist a "use my installed runtime" toggle. The default is on, so we
    /// keep `.env` clean by removing the key when enabled and writing an
    /// explicit `false` only when the user opts out.
    private func persistRuntimeFlag(_ key: String, useInstalled: Bool) {
        if useInstalled {
            pairs.removeAll { $0.key == key }
        } else if let idx = pairs.firstIndex(where: { $0.key == key }) {
            pairs[idx] = EnvPair(key: key, value: "false", isSecret: false)
        } else {
            pairs.append(EnvPair(key: key, value: "false", isSecret: false))
        }
        persistIfValid()
    }

    private func setPanelSendingEnabled(_ isEnabled: Bool) {
        let key = "AGENT_SERVER_PANEL_ENABLED"
        if isEnabled {
            pairs.removeAll { $0.key == key }
        } else if let index = pairs.firstIndex(where: { $0.key == key }) {
            pairs[index] = EnvPair(key: key, value: "false", isSecret: false)
        } else {
            pairs.append(EnvPair(key: key, value: "false", isSecret: false))
        }
        persistIfValid()
        hasPendingPanelRestart = true
    }

    // MARK: - Telemetry persistence

    private func loadTelemetryFromPairs() {
        let lookup = Dictionary(uniqueKeysWithValues: pairs.map { ($0.key, $0.value) })
        if let mode = lookup[TelemetryEnvKey.mode], let parsed = TelemetryMode(rawValue: mode) {
            telemetryMode = parsed
        }
        if let sampleMs = lookup[TelemetryEnvKey.sampleMs], let parsed = Int(sampleMs), parsed > 0 {
            telemetrySampleSeconds = max(1, parsed / 1000)
        }
        if let maxEntries = lookup[TelemetryEnvKey.maxEntries], let parsed = Int(maxEntries), parsed > 0 {
            telemetryMaxEntries = parsed
        }
        if let include = lookup[TelemetryEnvKey.includeMetadata] {
            telemetryIncludeMetadata = include == "true"
        }
    }

    private func persistTelemetry() {
        let updates: [(String, String)] = [
            (TelemetryEnvKey.mode, telemetryMode.rawValue),
            (TelemetryEnvKey.sampleMs, String(telemetrySampleSeconds * 1000)),
            (TelemetryEnvKey.maxEntries, String(telemetryMaxEntries)),
            (TelemetryEnvKey.includeMetadata, telemetryIncludeMetadata ? "true" : "false"),
        ]
        // Replace-or-append each key while preserving the order of all other
        // pairs. EnvFileStore.save handles comment preservation downstream.
        var byKey: [String: Int] = [:]
        for (idx, pair) in pairs.enumerated() {
            byKey[pair.key] = idx
        }
        for (key, value) in updates {
            let updated = EnvPair(key: key, value: value, isSecret: false)
            if let idx = byKey[key] {
                pairs[idx] = updated
            } else {
                pairs.append(updated)
                byKey[key] = pairs.count - 1
            }
        }
        persistIfValid()
    }

    private func refreshValidation() {
        invalidKeys = Set(
            pairs
                .filter { !EnvFileStore.isValidKey($0.key) }
                .map(\.key)
        )
    }

    private func persistIfValid() {
        guard invalidKeys.isEmpty else { return }
        let nonEmpty = pairs.filter { !$0.key.isEmpty }
        do {
            try EnvFileStore.save(nonEmpty, to: envPath)
            saveError = nil
        } catch EnvFileStoreError.invalidKey(let key) {
            saveError = "Invalid key: \(key)"
        } catch {
            saveError = "Could not save .env: \(error.localizedDescription)"
        }
    }

    private var currentRuntimeSelection: RuntimeSelection {
        RuntimeSelection(
            usesInstalledClaude: useInstalledClaude,
            usesInstalledCodex: useInstalledCodex
        )
    }

    private func restartForRuntimeChange() {
        savedRuntimeSelection = currentRuntimeSelection
        monitor.requestServerRestart()
    }

    private func restartForGeneralChange() {
        savedResumeAfterWake = resumeAfterWake
        monitor.requestServerRestart()
    }

    private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.title = "Choose an Agent Server folder"
        panel.message = "Agent Server will keep agents and private connection settings in this folder."
        panel.prompt = "Use Folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = workspace.homeDirectory.deletingLastPathComponent()
        guard panel.runModal() == .OK, let selectedURL = panel.url else { return }

        let alert = NSAlert()
        alert.messageText = "Use this Agent Server folder?"
        alert.informativeText = "Agents will be read from \(selectedURL.path)/agents and private settings from \(selectedURL.path)/.env. Existing files will not be moved."
        alert.addButton(withTitle: "Use Folder")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        applyWorkspace(selectedURL)
    }

    private func openWorkspace() {
        try? FileManager.default.createDirectory(
            at: workspace.homeDirectory,
            withIntermediateDirectories: true
        )
        NSWorkspace.shared.open(workspace.homeDirectory)
    }

    private func restoreDefaultWorkspace() {
        AgentServerWorkspaceStore.restoreDefault()
        workspace = .default()
        reloadAfterWorkspaceChange()
    }

    private func applyWorkspace(_ url: URL) {
        AgentServerWorkspaceStore.setHomeDirectory(url)
        workspace = AgentServerWorkspace(homeDirectory: url)
        reloadAfterWorkspaceChange()
    }

    private func reloadAfterWorkspaceChange() {
        pairs = []
        saveError = nil
        monitor.workspaceDidChange()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            loadPairs()
            monitor.poll()
        }
    }
}

// MARK: - Telemetry types

enum TelemetryMode: String, Hashable {
    case live
    case batched
}

private enum RuntimeEnvKey {
    static let useInstalledClaude = "AGENT_SERVER_USE_INSTALLED_CLAUDE"
    static let useInstalledCodex = "AGENT_SERVER_USE_INSTALLED_CODEX"
}

private enum TelemetryEnvKey {
    static let mode = "AGENT_SERVER_TELEMETRY_PROGRESS_MODE"
    static let sampleMs = "AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS"
    static let maxEntries = "AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES"
    static let includeMetadata = "AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA"
}

// MARK: - Bottom-only rounded rectangle

/// A rectangle with only its bottom corners rounded. Shared by the Settings
/// and Connections drawers so both read as the same sheet sliding down.
struct BottomRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let r = min(radius, min(rect.width, rect.height) / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addArc(
            center: CGPoint(x: rect.maxX - r, y: rect.maxY - r),
            radius: r,
            startAngle: .degrees(0),
            endAngle: .degrees(90),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addArc(
            center: CGPoint(x: rect.minX + r, y: rect.maxY - r),
            radius: r,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}
