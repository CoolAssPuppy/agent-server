import SwiftUI
import NerdsUI
import AppKit
import UserNotifications

/// Settings drawer (mock 3NT-1). Pulls down over the main pane from the top
/// edge of the window. Three flat cards side by side: General,
/// Panel connections, Updates. Panel connections edits the selected workspace `.env`
/// via `EnvFileStore` (atomic, comment-preserving).
///
/// Visual rules:
///  - Overlay, not push. The drawer layers on top of the content; the main
///    pane stays put. The host is responsible for dimming the content behind.
///  - Inset from the window chrome (`NSpacing.lg` on left and right).
///  - Rounded bottom corners only.
///  - No drop shadows on the cards themselves — flat border + card fill.
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
            VStack(spacing: 0) {
                content
                footer
            }
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            loadPairs()
        }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            VStack(spacing: NSpacing.lg) {
                generalCard
                runtimeCard
                notificationsCard
            }
            VStack(alignment: .trailing, spacing: NSpacing.lg) {
                storageCard
                updatesCard
                contactCard
                // Advanced sits under Contact, right-aligned; toggling it opens
                // the power-user panels in the column to the right.
                advancedDisclosure
            }
            // Power-user knobs (panel telemetry, raw env grid) stay one click
            // away instead of front and center.
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                if showAdvancedSettings {
                    agentPanelCard
                    panelConnectionsCard
                    telemetryCard
                }
            }
        }
        .padding(.horizontal, NSpacing.xxl)
    }

    private var advancedDisclosure: some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { showAdvancedSettings.toggle() }
        } label: {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: showAdvancedSettings ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                Text("Advanced")
                    .font(NTypography.labelMedium)
            }
            .foregroundStyle(theme.tokens.mutedForeground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var footer: some View {
        HStack {
            Text("Made with love in Lisbon, Portugal.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text("© 2026 Strategic Nerds, Inc.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.vertical, NSpacing.md)
    }

    // MARK: - Cards

    private var generalCard: some View {
        SettingsCard(
            title: "General",
            titleContextActionLabel: monitor.demoModeState.contextMenuTitle,
            onTitleContextAction: monitor.toggleDemoMode
        ) {
            settingsToggle("Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, newValue in
                    LaunchAtLoginManager.shared.isEnabled = newValue
                }

            settingsToggle("Resume scheduled agents after wake", isOn: $resumeAfterWake)
                .onChange(of: resumeAfterWake) { _, newValue in
                    pairs = catchUpPreference.updating(pairs, to: newValue)
                    persistIfValid()
                }

            if resumeAfterWake != savedResumeAfterWake {
                restartNotice(action: restartForGeneralChange)
            }

            settingsToggle("Help improve Agent Server", isOn: $telemetryOptIn)
                .onChange(of: telemetryOptIn) { _, newValue in
                    Telemetry.setOptedIn(newValue)
                }

            settingsRow(label: "Server status") {
                statusPill(
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

    private var runtimeCard: some View {
        SettingsCard(title: "Claude and Codex") {
            Text("Use the versions already installed on this Mac.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            settingsToggle("Use installed Claude", isOn: $useInstalledClaude)
                .onChange(of: useInstalledClaude) { _, newValue in
                    persistRuntimeFlag(RuntimeEnvKey.useInstalledClaude, useInstalled: newValue)
                }

            settingsToggle("Use installed Codex", isOn: $useInstalledCodex)
                .onChange(of: useInstalledCodex) { _, newValue in
                    persistRuntimeFlag(RuntimeEnvKey.useInstalledCodex, useInstalled: newValue)
                }

            if currentRuntimeSelection.requiresRestart(comparedTo: savedRuntimeSelection) {
                restartNotice(action: restartForRuntimeChange)
                    .accessibilityIdentifier("settings.restartRuntime")
            }
        }
    }

    private var storageCard: some View {
        SettingsCard(title: "Agent Server folder") {
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

    private var panelConnectionsCard: some View {
        SettingsCard(title: "Environment") {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                // Grid body: header + rows. Single outer surface with a
                // divider between header and body and between rows. The +/-
                // toolbar sits outside the grid at the bottom of the card.
                VStack(spacing: 0) {
                    headerRow
                        .padding(.horizontal, NSpacing.sm)
                        .padding(.vertical, 6)
                    Divider().opacity(0.4)

                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(pairs.enumerated()), id: \.offset) { idx, pair in
                                connectionRow(index: idx, pair: pair)
                                    .padding(.horizontal, NSpacing.sm)
                                    .padding(.vertical, 4)
                                    .background(
                                        selectedIndex == idx
                                            ? theme.tokens.primary.opacity(0.10)
                                            : Color.clear
                                    )
                                    .contentShape(Rectangle())
                                    .onTapGesture { selectedIndex = idx }
                                if idx < pairs.count - 1 {
                                    Divider().opacity(0.25)
                                }
                            }
                        }
                    }
                    // Minimum height keeps a stable 3-row footprint visible
                    // even when the user has only a couple of env vars set,
                    // so the card doesn't collapse to a thin strip and the
                    // +/- toolbar always has the same visual anchor.
                    .frame(minHeight: 110, maxHeight: 240)
                }
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.background)
                        .overlay(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .stroke(theme.tokens.border, lineWidth: 1)
                        )
                )

                gridToolbar

                if !invalidKeys.isEmpty {
                    Text("Keys must match `[A-Z][A-Z0-9_]*`.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.destructive)
                }
                if let saveError {
                    Text(saveError)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.destructive)
                }
            }
        }
    }

    private var agentPanelCard: some View {
        SettingsCard(title: "Agent Panel") {
            settingsToggle("Send data to Agent Panel", isOn: panelSendingBinding)
                .disabled(!agentPanelSettings.hasRequiredCredentials)
                .opacity(agentPanelSettings.hasRequiredCredentials ? 1 : 0.45)

            if !agentPanelSettings.hasRequiredCredentials {
                Text("Add both the Agent Panel URL and API key below to turn this on.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            settingsRow(label: "Agent Panel connection") {
                statusPill(
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
        }
    }

    /// +/- toolbar pinned under the grid. Mirrors the Finder/NSTableView
    /// idiom: click a row to select, `-` removes it, `+` appends a new row.
    private var gridToolbar: some View {
        HStack(spacing: 0) {
            Button(action: appendRow) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.tokens.foreground)
                    .frame(width: 24, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Add connection")

            Divider().frame(height: 14).opacity(0.4)

            Button(action: removeSelectedRow) {
                Image(systemName: "minus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(
                        selectedIndex == nil
                            ? theme.tokens.mutedForeground.opacity(0.5)
                            : theme.tokens.foreground
                    )
                    .frame(width: 24, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(selectedIndex == nil)
            .help("Remove selected connection")

            Spacer()
        }
        .background(
            RoundedRectangle(cornerRadius: NRadius.xs)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
    }

    private func appendRow() {
        pairs.append(EnvPair(key: "", value: "", isSecret: false))
        selectedIndex = pairs.count - 1
        refreshValidation()
    }

    private func removeSelectedRow() {
        guard let idx = selectedIndex, pairs.indices.contains(idx) else { return }
        deleteRow(at: idx)
        if pairs.isEmpty {
            selectedIndex = nil
        } else {
            selectedIndex = min(idx, pairs.count - 1)
        }
    }

    private var headerRow: some View {
        HStack(spacing: NSpacing.sm) {
            Text("KEY")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("VALUE")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func connectionRow(index: Int, pair: EnvPair) -> some View {
        HStack(spacing: NSpacing.sm) {
            keyField(index: index, pair: pair)
                .frame(maxWidth: .infinity, alignment: .leading)
            valueField(index: index, pair: pair)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func keyField(index: Int, pair: EnvPair) -> some View {
        let binding = Binding<String>(
            get: { pairs[index].key },
            set: { newKey in
                let updated = EnvPair(
                    key: newKey,
                    value: pairs[index].value,
                    isSecret: EnvFileStore.isSecretKey(newKey)
                )
                pairs[index] = updated
                refreshValidation()
            }
        )
        return TextField("KEY", text: binding, onCommit: persistIfValid)
            .textFieldStyle(.plain)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, NSpacing.xs)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(theme.tokens.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(
                                invalidKeys.contains(pair.key)
                                    ? theme.tokens.destructive
                                    : theme.tokens.border,
                                lineWidth: 1
                            )
                    )
            )
    }

    @ViewBuilder
    private func valueField(index: Int, pair: EnvPair) -> some View {
        let isRevealed = revealedKeys.contains(pair.key)
        let shouldMask = pair.isSecret && !isRevealed
        let isEditing = editingKey == pair.key && !shouldMask

        if shouldMask {
            HStack(spacing: NSpacing.xxs) {
                Text(EnvFileStore.masked(value: pair.value))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                Spacer()
                Button {
                    revealedKeys.insert(pair.key)
                } label: {
                    Image(systemName: "eye")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Reveal \(pair.key)")
            }
            .padding(.horizontal, NSpacing.xs)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(theme.tokens.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
            )
            .onTapGesture {
                revealedKeys.insert(pair.key)
                editingKey = pair.key
            }
        } else {
            let binding = Binding<String>(
                get: { pairs[index].value },
                set: { newValue in
                    pairs[index] = EnvPair(
                        key: pairs[index].key,
                        value: newValue,
                        isSecret: pairs[index].isSecret
                    )
                }
            )
            HStack(spacing: NSpacing.xxs) {
                TextField("value", text: binding, onCommit: {
                    editingKey = nil
                    persistIfValid()
                })
                .textFieldStyle(.plain)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(theme.tokens.foreground)
                if pair.isSecret && isEditing {
                    Button {
                        revealedKeys.remove(pair.key)
                        editingKey = nil
                        persistIfValid()
                    } label: {
                        Image(systemName: "eye.slash")
                            .font(.system(size: 10))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hide \(pair.key)")
                }
            }
            .padding(.horizontal, NSpacing.xs)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(theme.tokens.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
            )
        }
    }


    private var notificationsCard: some View {
        SettingsCard(title: "Notifications") {
            settingsToggle("Enable notifications", isOn: $notificationPreferences.enabled)

            if notificationPreferences.enabled {
                settingsToggle("Notify for agent output", isOn: $notificationPreferences.includeAgentOutput)
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

    /// Panel telemetry batching controls. Persists into the selected workspace `.env`.
    /// as the four `AGENT_SERVER_TELEMETRY_PROGRESS_*` keys. Server reads
    /// these on launch, so changes take effect after the next server restart.
    /// Per-agent overrides in agent YAML always win over these values.
    private var telemetryCard: some View {
        SettingsCard(title: "Telemetry") {
            settingsRow(label: "Progress mode") {
                Picker("", selection: $telemetryMode) {
                    Text("Live").tag(TelemetryMode.live)
                    Text("Batched").tag(TelemetryMode.batched)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .frame(width: 140)
                .onChange(of: telemetryMode) { _, _ in persistTelemetry() }
            }

            settingsRow(label: "Sample interval (s)") {
                Stepper(value: $telemetrySampleSeconds, in: 1...600) {
                    Text("\(telemetrySampleSeconds)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(theme.tokens.foreground)
                }
                .controlSize(.mini)
                .onChange(of: telemetrySampleSeconds) { _, _ in persistTelemetry() }
            }

            settingsRow(label: "Max progress entries") {
                Stepper(value: $telemetryMaxEntries, in: 1...500) {
                    Text("\(telemetryMaxEntries)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(theme.tokens.foreground)
                }
                .controlSize(.mini)
                .onChange(of: telemetryMaxEntries) { _, _ in persistTelemetry() }
            }

            settingsToggle("Include progress metadata", isOn: $telemetryIncludeMetadata)
                .onChange(of: telemetryIncludeMetadata) { _, _ in persistTelemetry() }

            Text("Per-agent telemetry blocks override these values. Restart the server to apply changes.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var updatesCard: some View {
        SettingsCard(title: "Updates") {
            settingsToggle(
                "Automatically check for updates",
                isOn: $updater.automaticallyChecksForUpdates
            )

            settingsRow(label: "Current version") {
                Text(version)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }

            Button {
                UpdaterManager.shared.checkForUpdates()
            } label: {
                Text("Check for updates…")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.tokens.foreground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, NSpacing.xs)
                    .background(
                        RoundedRectangle(cornerRadius: NRadius.sm)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
        }
    }

    private var contactCard: some View {
        SettingsCard(title: "Contact") {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                HStack(alignment: .center, spacing: NSpacing.xs) {
                    Image(systemName: "ladybug.fill")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Link("bugs@agentpanel.dev",
                         destination: URL(string: "mailto:bugs@agentpanel.dev")!)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.tokens.primary)
                }

                Link(destination: URL(string: "https://github.com/coolasspuppy/agent-server")!) {
                    HStack(alignment: .center, spacing: NSpacing.xs) {
                        Image("GitHubMark")
                            .renderingMode(.template)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text("coolasspuppy/agent-server")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.tokens.primary)
                    }
                }

                Link(destination: URL(string: "https://www.agentpanel.dev")!) {
                    HStack(alignment: .center, spacing: NSpacing.xs) {
                        Image("MenuBarIcon")
                            .renderingMode(.template)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text("Get Agent Panel")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.tokens.primary)
                    }
                }

                Link(destination: URL(string: "https://venmo.com/u/coolasspuppy")!) {
                    HStack(alignment: .center, spacing: NSpacing.xs) {
                        Image(systemName: "cup.and.saucer.fill")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text("Buy me coffee.")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.tokens.primary)
                    }
                }

                Link(destination: URL(string: "https://www.strategicnerds.com/picksandshovels")!) {
                    HStack(alignment: .center, spacing: NSpacing.xs) {
                        Image(systemName: "book.closed.fill")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text("Buy my book.")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.tokens.primary)
                    }
                }
            }
        }
    }

    // MARK: - Row helpers

    private func settingsToggle(_ label: String, isOn: Binding<Bool>) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.vertical, 4)
    }

    private func settingsRow<Trailing: View>(
        label: String,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            trailing()
        }
        .padding(.vertical, 4)
    }

    private func statusPill(isHealthy: Bool, label: String) -> some View {
        HStack(spacing: NSpacing.xxs) {
            Circle()
                .fill(isHealthy ? Color.green : Color.orange)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(theme.tokens.foreground)
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

    private func deleteRow(at index: Int) {
        guard pairs.indices.contains(index) else { return }
        let removed = pairs.remove(at: index)
        revealedKeys.remove(removed.key)
        refreshValidation()
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

    private func restartNotice(action: @escaping () -> Void) -> some View {
        HStack(alignment: .center, spacing: NSpacing.sm) {
            Text("Restart Agent Server to use this change.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer(minLength: NSpacing.xs)
            Button("Restart now", action: action)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
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

// MARK: - Card container (flat: border + card fill, no shadows)

private struct SettingsCard<Content: View>: View {
    let title: String
    let titleContextActionLabel: String?
    let onTitleContextAction: (() -> Void)?
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    init(
        title: String,
        titleContextActionLabel: String? = nil,
        onTitleContextAction: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.titleContextActionLabel = titleContextActionLabel
        self.onTitleContextAction = onTitleContextAction
        self.content = content
    }

    var body: some View {
        // No trailing Spacer: cards size to their content. Without this,
        // the bottom card in each column would stretch to fill whatever
        // the tallest column (now the middle one with telemetry) is using.
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.tokens.mutedForeground)
                .contextMenu {
                    if let titleContextActionLabel, let onTitleContextAction {
                        Button(titleContextActionLabel, action: onTitleContextAction)
                    }
                }
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                content()
            }
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
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
