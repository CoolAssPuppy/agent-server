import SwiftUI
import AgentServerDesignSystem

private enum ConnectionPanelStyle {
    static let listWidth: CGFloat = 400
    static let transitionDuration = 0.22
}

/// Named connections lead. Runtime details and service templates remain available on demand.
struct ConnectionsView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    var onClose: (() -> Void)? = nil

    @Environment(\.nTheme) private var theme
    @State private var catalog: [CapabilityCatalogEntry] = []
    @State private var registeredServices: [GuidanceServiceConnection] = []
    @State private var savedProfiles: [ConnectionProfile] = []
    @State private var snapshot: ConnectionSnapshot = .empty
    @State private var loaded = false
    @State private var refreshing = false
    @State private var connectTarget: CatalogConnectTarget?
    @State private var isAddingConnection = false
    @State private var telegramConnected = false
    @State private var slackMessagingConnected = false
    @State private var navigation = ConnectionPanelNavigationState()
    @State private var showsConnectionTemplates = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let telegramTokenKey = "AGENT_SERVER_TELEGRAM_BOT_TOKEN"
    private static let slackBotTokenKey = "SLACK_BOT_TOKEN"
    private static let slackAppTokenKey = "SLACK_APP_TOKEN"

    private var telegramEntry: CapabilityCatalogEntry {
        CapabilityCatalogEntry(
            id: "telegram",
            label: "Telegram",
            description: "Message your agents and get their replies through a Telegram bot",
            icon: "paperplane.fill",
            kind: "channel",
            auth: .apiKey,
            builtin: false,
            requiredEnv: [Self.telegramTokenKey],
            envReady: telegramConnected
        )
    }

    private var slackMessagingEntry: CapabilityCatalogEntry {
        CapabilityCatalogEntry(
            id: "slack-bot",
            label: "Slack",
            description: "Message your agents and get their replies through a Slack bot",
            icon: "bubble.left.and.bubble.right",
            kind: "channel",
            auth: .apiKey,
            builtin: false,
            requiredEnv: [Self.slackBotTokenKey, Self.slackAppTokenKey],
            envReady: slackMessagingConnected
        )
    }

    private var services: [CapabilityCatalogEntry] {
        catalog.filter { $0.kind == "mcp" }
    }

    private var credentialCatalog: [CapabilityCatalogEntry] {
        services.filter { !$0.requiredEnv.isEmpty }
    }

    private var credentialPresentation: ConnectionCredentialsPresentation {
        ConnectionCredentialsPresentation(
            catalog: credentialCatalog.map {
                ConnectionCatalogService(
                    id: $0.id,
                    name: $0.label,
                    requiredEnvironmentKeys: $0.requiredEnv
                )
            },
            connections: registeredServices
        )
    }

    var body: some View {
        TopDrawerSurface(
            title: "Connections",
            closeLabel: "Close connections",
            onClose: close,
            onEscape: stepBackOrClose,
            headerActions: { headerActions }
        ) {
            HStack(spacing: 0) {
                mainPanel
                if let profile = selectedProfile {
                    Divider().opacity(0.35)
                    savedConnectionDetail(profile)
                        .id(profile.id)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .animation(
                reduceMotion ? nil : .easeInOut(duration: ConnectionPanelStyle.transitionDuration),
                value: navigation.selectedConnectionID
            )
        }
        .task {
            guard !loaded else { return }
            loaded = true
            catalog = await monitor.capabilityCatalog()
            registeredServices = await monitor.serviceConnections()
            savedProfiles = await monitor.connectionProfiles()
            snapshot = await monitor.connections()
            telegramConnected = Self.isConnected(Self.telegramTokenKey)
            slackMessagingConnected = Self.isConnected(Self.slackBotTokenKey)
                && Self.isConnected(Self.slackAppTokenKey)
            // The boot probe may still be in flight the first time this opens,
            // so a fresh install shows "Checking…". Await it once — the server
            // cache coalesces, so this joins the in-flight probe rather than
            // starting another.
            if snapshot.discoveredAt == nil {
                refreshing = true
                snapshot = await monitor.refreshConnections()
                refreshing = false
            }
        }
        .sheet(item: $connectTarget) { target in
            ConnectServiceSheet(monitor: monitor, entry: target.entry) {
                connectTarget = nil
                telegramConnected = Self.isConnected(Self.telegramTokenKey)
                slackMessagingConnected = Self.isConnected(Self.slackBotTokenKey)
                    && Self.isConnected(Self.slackAppTokenKey)
                Task { catalog = await monitor.capabilityCatalog() }
                Task { registeredServices = await monitor.serviceConnections() }
            }
        }
        .sheet(isPresented: $isAddingConnection) {
            GenericConnectionSetupSheet(monitor: monitor) { profile in
                savedProfiles.append(profile)
                isAddingConnection = false
                navigation.selectConnection(profile.id)
                Task { registeredServices = await monitor.serviceConnections() }
            } onCancel: {
                isAddingConnection = false
            }
        }
    }

    private func close() {
        if let onClose { onClose() } else { router.close() }
    }

    private func stepBackOrClose() {
        if !navigation.stepBack() {
            close()
        }
    }

    private var selectedProfile: ConnectionProfile? {
        guard let id = navigation.selectedConnectionID else { return nil }
        return savedProfiles.first { $0.id == id }
    }

    private var mainPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                ForEach(ConnectionScreenSection.primary, id: \.self) { section in
                    primarySection(section)
                }
                servicesSection
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.vertical, NSpacing.xl)
        }
        .defaultScrollAnchor(.top)
        .frame(width: navigation.selectedConnectionID == nil ? nil : ConnectionPanelStyle.listWidth)
        .frame(maxHeight: .infinity)
        .frame(maxWidth: navigation.selectedConnectionID == nil ? .infinity : nil)
    }

    @ViewBuilder
    private func primarySection(_ section: ConnectionScreenSection) -> some View {
        switch section {
        case .saved: savedConnectionsSection
        case .engines: enginesSection
        case .claude: availableSection
        case .messaging: messagingSection
        case .templates: EmptyView()
        }
    }

    private var enginesSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            ConnectionSectionHeader(section: .engines)

            ConnectionInsetGroup {
                ForEach(Array(snapshot.runtimes.enumerated()), id: \.element.id) { index, runtime in
                    if index > 0 { Divider().opacity(0.25) }
                    RuntimeConnectionRow(
                        presentation: RuntimeConnectionPresentation(runtime: runtime)
                    )
                }
            }
        }
    }

    private func savedConnectionDetail(_ profile: ConnectionProfile) -> some View {
        let presentation = ConnectionProfilePresentation(
            profile: profile,
            configuredEnvironmentVariables: configuredEnvironmentVariables
        )
        return SavedConnectionDetailView(
            presentation: presentation,
            onBack: { _ = navigation.stepBack() },
            onModifyCredentials: {
                connectTarget = CatalogConnectTarget(entry: connectionEntry(for: profile, presentation: presentation))
            },
            onRename: { label in
                let renamed = try await monitor.renameConnectionProfile(id: profile.id, label: label)
                replaceSavedProfile(renamed)
                return renamed
            },
            onDuplicate: {
                let duplicate = try await monitor.duplicateConnectionProfile(
                    id: profile.id,
                    label: ConnectionCopyName.suggested(from: profile.label)
                )
                savedProfiles.append(duplicate)
                navigation.selectConnection(duplicate.id)
                return duplicate
            },
            onCheck: { try await monitor.checkConnectionProfile(id: profile.id) },
            onRemove: {
                try await monitor.removeConnectionProfile(id: profile.id)
                savedProfiles.removeAll { $0.id == profile.id }
                _ = navigation.stepBack()
                registeredServices = await monitor.serviceConnections()
            }
        )
    }

    private func replaceSavedProfile(_ profile: ConnectionProfile) {
        guard let index = savedProfiles.firstIndex(where: { $0.id == profile.id }) else { return }
        savedProfiles[index] = profile
    }

    private var refreshButton: some View {
        Button {
            Task {
                refreshing = true
                snapshot = await monitor.refreshConnections()
                refreshing = false
            }
        } label: {
            Group {
                if refreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(refreshing)
        .help("Check for connections again")
        .accessibilityLabel("Refresh connections")
    }

    private var headerActions: some View {
        HStack(spacing: NSpacing.xs) {
            Button {
                isAddingConnection = true
            } label: {
                Image(systemName: "plus")
                    .font(NTypography.bodyMedium)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Add advanced connection")
            .accessibilityLabel("Add advanced connection")
            .accessibilityIdentifier("connections.add")
            refreshButton
        }
    }

    private var savedConnectionsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            ConnectionSectionHeader(section: .saved)

            if savedProfiles.isEmpty {
                Button {
                    isAddingConnection = true
                } label: {
                    Label("Add an advanced connection", systemImage: "plus.circle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(NSpacing.lg)
                }
                .buttonStyle(.plain)
                .background(theme.tokens.muted.opacity(0.28))
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md, style: .continuous))
            } else {
                ConnectionInsetGroup {
                    ForEach(Array(savedProfiles.enumerated()), id: \.element.id) { index, profile in
                        if index > 0 { Divider().opacity(0.25) }
                        SavedConnectionRow(
                            presentation: ConnectionProfilePresentation(
                                profile: profile,
                                configuredEnvironmentVariables: configuredEnvironmentVariables
                            ),
                            isSelected: navigation.selectedConnectionID == profile.id,
                            onSelect: { navigation.selectConnection(profile.id) }
                        )
                    }
                }
            }
        }
    }

    private var configuredEnvironmentVariables: Set<String> {
        let url = AgentServerWorkspaceStore.current().environmentFile
        let pairs = (try? EnvFileStore.load(from: url)) ?? []
        return Set(pairs.compactMap { pair in
            pair.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : pair.key
        })
    }

    // MARK: - Available through Claude (live)

    /// The connectors the Claude runtime can actually reach right now, probed
    /// from the running server. This is the live truth, not a static promise.
    private var availableSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            ConnectionSectionHeader(section: .claude)

            availableContent
        }
    }

    @ViewBuilder
    private var availableContent: some View {
        let connectors = snapshot.servers
        if connectors.isEmpty {
            emptyAvailableCard
        } else {
            ConnectionInsetGroup {
                ForEach(Array(connectors.enumerated()), id: \.element.id) { index, connector in
                    if index > 0 { Divider().opacity(0.25) }
                    DiscoveredConnectionRow(connector: connector)
                }
            }
        }
    }

    private var emptyAvailableCard: some View {
        let presentation = ClaudeConnectionDiscoveryPresentation(
            discoveredAt: snapshot.discoveredAt,
            didProbeFail: snapshot.didProbeFail,
            connectionCount: snapshot.servers.count
        )
        return HStack(spacing: NSpacing.md) {
            Image(systemName: snapshot.didProbeFail
                  ? "exclamationmark.arrow.triangle.2.circlepath"
                  : snapshot.discoveredAt == nil ? "sparkles" : "questionmark.circle")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(theme.tokens.accent)
                .frame(width: 24)
            Text(presentation.emptyMessage ?? "")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.muted.opacity(0.28))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md, style: .continuous))
    }

    // MARK: - Services

    private var servicesSection: some View {
        DisclosureGroup(ConnectionScreenSection.templates.title, isExpanded: $showsConnectionTemplates) {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Text("\(ConnectionScreenSection.templates.explanation) Custom web endpoints and local commands are available through Add advanced connection.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)

                ConnectionInsetGroup {
                    ForEach(Array(credentialPresentation.rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider().opacity(0.25) }
                        CredentialConnectionRow(row: row, catalogEntry: catalogEntry(for: row)) {
                            connectTarget = CatalogConnectTarget(entry: connectionEntry(for: row))
                        }
                    }
                }
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.bodyMedium)
    }

    private func catalogEntry(for row: ConnectionCredentialRow) -> CapabilityCatalogEntry? {
        credentialCatalog.first(where: { $0.id == row.serviceId })
    }

    private func connectionEntry(for row: ConnectionCredentialRow) -> CapabilityCatalogEntry {
        let base = catalogEntry(for: row)
        return CapabilityCatalogEntry(
            id: row.id,
            label: row.name,
            description: base?.description ?? "A private connection for this service",
            icon: base?.icon ?? "key",
            kind: "mcp",
            auth: .apiKey,
            builtin: false,
            requiredEnv: row.requiredEnvironmentKeys,
            envReady: row.status == .connected && row.action == .modifyKeys
        )
    }

    private func connectionEntry(
        for profile: ConnectionProfile,
        presentation: ConnectionProfilePresentation
    ) -> CapabilityCatalogEntry {
        CapabilityCatalogEntry(
            id: profile.id,
            label: profile.label,
            description: "Credentials for \(presentation.connectionMethod.lowercased())",
            icon: "point.3.connected.trianglepath.dotted",
            kind: "mcp",
            auth: .apiKey,
            builtin: false,
            requiredEnv: profile.credentials.map(\.environmentVariable),
            envReady: presentation.status == .ready
        )
    }

    // MARK: - Messaging

    private var messagingSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            ConnectionSectionHeader(section: .messaging)

            ConnectionInsetGroup {
                ConnectionRow(entry: telegramEntry) {
                    connectTarget = CatalogConnectTarget(entry: telegramEntry)
                }
                Divider().opacity(0.25)
                ConnectionRow(entry: slackMessagingEntry) {
                    connectTarget = CatalogConnectTarget(entry: slackMessagingEntry)
                }
            }

            if telegramConnected || slackMessagingConnected {
                pairingHint
            }
        }
    }

    /// Shown once a messaging bot token is saved: the bot only learns where to
    /// reach you from your first message, so an unpaired bot silently drops its
    /// first notification. This tells the user to close that loop.
    private var pairingHint: some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            Image(systemName: "hand.wave")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.tokens.accent)
                .frame(width: 18)
            Text("One more step: send your bot a message (a quick \u{201C}hi\u{201D}) so it learns where to reach you. Until you do, its first notification has nowhere to go.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(NSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: NRadius.md).fill(theme.tokens.accent.opacity(0.08))
        )
    }

    /// Whether an env key is set (non-empty) in Agent Server's environment file.
    private static func isConnected(_ key: String) -> Bool {
        let url = AgentServerWorkspaceStore.current().environmentFile
        guard let pairs = try? EnvFileStore.load(from: url),
              let pair = pairs.first(where: { $0.key == key }) else { return false }
        return !pair.value.trimmingCharacters(in: .whitespaces).isEmpty
    }
}
