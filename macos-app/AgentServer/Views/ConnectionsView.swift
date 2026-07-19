import SwiftUI
import NerdsUI

/// Connections: one place that answers "what can my agents reach, and how do I
/// give them more." Two truths, stated plainly:
///  1. Anything you've connected in Claude is already available to your agents.
///  2. You can add your own API keys here; they're stored privately in .env.
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

    private static let telegramTokenKey = "AGENT_SERVER_TELEGRAM_BOT_TOKEN"
    // Bare Slack token names (no AGENT_SERVER_ prefix): what Slack's own docs use
    // and what the user keeps in Doppler/.env. The server accepts both forms.
    private static let slackBotTokenKey = "SLACK_BOT_TOKEN"
    private static let slackAppTokenKey = "SLACK_APP_TOKEN"

    /// Telegram is a server-wide messaging channel (bot token), not a per-agent
    /// capability, so it isn't in the catalog. Present it here as its own
    /// connection with the same Add-keys flow.
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

    /// Slack as a two-way messaging channel (chat with a bot) — distinct from
    /// the Slack data connection above. Socket Mode needs a bot token (sending)
    /// and an app-level token (receiving), so it collects both keys.
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

    /// Only the service connections (MCP) — the file/command/web capabilities
    /// are agent permissions, not connections, and belong on the agent page.
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
            headerActions: { headerActions }
        ) {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    savedConnectionsSection
                    availableSection
                    servicesSection
                    messagingSection
                }
                .padding(.horizontal, NSpacing.xxl)
                .padding(.vertical, NSpacing.xl)
            }
            // The available list grows from a short "Checking…" card to the full
            // connector list once the probe returns; anchoring to the top keeps
            // the view pinned there instead of drifting as content grows below.
            .defaultScrollAnchor(.top)
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
                Task { registeredServices = await monitor.serviceConnections() }
            } onCancel: {
                isAddingConnection = false
            }
        }
    }

    private func close() {
        if let onClose { onClose() } else { router.close() }
    }

    private var refreshButton: some View {
        Button {
            Task {
                refreshing = true
                snapshot = await monitor.refreshConnections()
                refreshing = false
            }
        } label: {
            ZStack {
                Circle().fill(theme.tokens.muted)
                    .overlay(Circle().stroke(theme.tokens.border, lineWidth: 1))
                if refreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            .frame(width: 28, height: 28)
            .contentShape(Circle())
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
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(theme.tokens.muted))
                    .overlay(Circle().stroke(theme.tokens.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .help("Add connection")
            .accessibilityLabel("Add connection")
            .accessibilityIdentifier("connections.add")
            refreshButton
        }
    }

    private var savedConnectionsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text("YOUR CONNECTIONS")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Reusable accounts and tools you configured for Agent Server.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)

            if savedProfiles.isEmpty {
                Button {
                    isAddingConnection = true
                } label: {
                    Label("Add your first connection", systemImage: "plus.circle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(NSpacing.lg)
                }
                .buttonStyle(.plain)
                .background(theme.tokens.background)
                .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(savedProfiles.enumerated()), id: \.element.id) { index, profile in
                        if index > 0 { Divider().opacity(0.25) }
                        SavedConnectionRow(
                            presentation: ConnectionProfilePresentation(
                                profile: profile,
                                configuredEnvironmentVariables: configuredEnvironmentVariables
                            )
                        )
                    }
                }
                .background(theme.tokens.background)
                .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
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
            Text("AVAILABLE THROUGH CLAUDE")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Every app you've connected in Claude is available to your agents automatically, using your existing sign-in. This is what the server can reach right now.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            availableContent
        }
    }

    @ViewBuilder
    private var availableContent: some View {
        let connectors = snapshot.servers
        if connectors.isEmpty {
            emptyAvailableCard
        } else {
            VStack(spacing: 0) {
                ForEach(Array(connectors.enumerated()), id: \.element.id) { index, connector in
                    if index > 0 { Divider().opacity(0.25) }
                    DiscoveredConnectionRow(connector: connector)
                }
            }
            .background(theme.tokens.background)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
    }

    private var emptyAvailableCard: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: snapshot.discoveredAt == nil ? "sparkles" : "questionmark.circle")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(theme.tokens.accent)
                .frame(width: 24)
            Text(snapshot.discoveredAt == nil
                 ? "Checking what your agents can reach…"
                 : "No connections found yet. Connect apps in Claude, then Refresh.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.background)
        .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    // MARK: - Services

    private var servicesSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text("CONNECT WITH YOUR OWN KEYS")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Prefer your own account or a self-hosted server? Add its keys and they are stored privately in your Agent Server folder, never inside an agent file.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                ForEach(Array(credentialPresentation.rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Divider().opacity(0.25) }
                    CredentialConnectionRow(row: row, catalogEntry: catalogEntry(for: row)) {
                        connectTarget = CatalogConnectTarget(entry: connectionEntry(for: row))
                    }
                }
            }
            .background(theme.tokens.background)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
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

    // MARK: - Messaging

    private var messagingSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text("MESSAGING")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Chat with your agents from Telegram or Slack. Add a bot token and your agents can message you and take your replies.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                ConnectionRow(entry: telegramEntry) {
                    connectTarget = CatalogConnectTarget(entry: telegramEntry)
                }
                Divider().opacity(0.25)
                ConnectionRow(entry: slackMessagingEntry) {
                    connectTarget = CatalogConnectTarget(entry: slackMessagingEntry)
                }
            }
            .background(theme.tokens.background)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))

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
        .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.accent.opacity(0.25), lineWidth: 1))
    }

    /// Whether an env key is set (non-empty) in Agent Server's environment file.
    private static func isConnected(_ key: String) -> Bool {
        let url = AgentServerWorkspaceStore.current().environmentFile
        guard let pairs = try? EnvFileStore.load(from: url),
              let pair = pairs.first(where: { $0.key == key }) else { return false }
        return !pair.value.trimmingCharacters(in: .whitespaces).isEmpty
    }
}
