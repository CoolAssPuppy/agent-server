import SwiftUI
import NerdsUI

/// Connections: one place that answers "what can my agents reach, and how do I
/// give them more." Two truths, stated plainly:
///  1. Anything you've connected in Claude is already available to your agents.
///  2. You can add your own API keys here; they're stored privately in .env.
struct ConnectionsView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme
    @State private var catalog: [CapabilityCatalogEntry] = []
    @State private var snapshot: ConnectionSnapshot = .empty
    @State private var loaded = false
    @State private var refreshing = false
    @State private var connectTarget: CatalogConnectTarget?
    @State private var telegramConnected = false

    private static let telegramTokenKey = "AGENT_SERVER_TELEGRAM_BOT_TOKEN"

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

    /// Only the service connections (MCP) — the file/command/web capabilities
    /// are agent permissions, not connections, and belong on the agent page.
    private var services: [CapabilityCatalogEntry] {
        catalog.filter { $0.kind == "mcp" }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
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
        // Match the Settings drawer: same fixed height, card surface, rounded
        // bottom, and soft shadow. Content scrolls inside.
        .frame(maxWidth: .infinity)
        .frame(height: SettingsDrawer.height)
        .background(theme.tokens.card)
        .clipShape(BottomRoundedRectangle(radius: NRadius.md))
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 16, x: 0, y: 6)
        .onKeyPress(.escape) {
            router.close()
            return .handled
        }
        .task {
            guard !loaded else { return }
            loaded = true
            catalog = await monitor.capabilityCatalog()
            snapshot = await monitor.connections()
            telegramConnected = Self.isTelegramConnected()
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
                Task { catalog = await monitor.capabilityCatalog() }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Connections")
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            refreshButton
            Button(action: router.close) {
                ZStack {
                    Circle().fill(theme.tokens.muted)
                        .overlay(Circle().stroke(theme.tokens.border, lineWidth: 1))
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .frame(width: 28, height: 28)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close connections")
        }
        .padding(.horizontal, NSpacing.xxl)
        // Reserve space for the transparent titlebar's traffic lights, matching
        // the Settings drawer so the title sits just below them.
        .padding(.top, 28)
        .padding(.bottom, NSpacing.md)
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
            Text("Prefer your own account or a self-hosted server? Add its keys and they're stored privately in ~/.agent-server/.env.local — never inside an agent file.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                ForEach(Array(services.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { Divider().opacity(0.25) }
                    ConnectionRow(entry: entry) { connectTarget = CatalogConnectTarget(entry: entry) }
                }
            }
            .background(theme.tokens.background)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
    }

    // MARK: - Messaging

    private var messagingSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text("MESSAGING")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Chat with your agents from your phone. Add a Telegram bot token and your agents can message you and take your replies.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                ConnectionRow(entry: telegramEntry) {
                    connectTarget = CatalogConnectTarget(entry: telegramEntry)
                }
            }
            .background(theme.tokens.background)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
    }

    /// Whether the Telegram bot token is already set in either env file.
    private static func isTelegramConnected() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser
        for name in [".agent-server/.env.local", ".agent-server/.env"] {
            let url = home.appendingPathComponent(name)
            if let pairs = try? EnvFileStore.load(from: url),
               let pair = pairs.first(where: { $0.key == telegramTokenKey }),
               !pair.value.trimmingCharacters(in: .whitespaces).isEmpty {
                return true
            }
        }
        return false
    }
}

// MARK: - Row

private struct ConnectionRow: View {
    let entry: CapabilityCatalogEntry
    let onConnect: () -> Void

    @Environment(\.nTheme) private var theme

    private var isConnected: Bool { entry.envReady && !entry.requiredEnv.isEmpty }
    private var isKeyless: Bool { entry.requiredEnv.isEmpty }

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(
                capability: entry.asCapability,
                size: 18,
                tint: theme.tokens.foreground
            )
            .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.label)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text(entry.description)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
            }
            Spacer()
            trailing
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.md)
    }

    @ViewBuilder
    private var trailing: some View {
        if entry.auth == .oauth {
            statusPill("Sign in from Claude", color: theme.tokens.mutedForeground)
        } else if isKeyless {
            statusPill("Built in", color: theme.tokens.mutedForeground)
        } else if isConnected {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.tokens.success)
                Text("Connected")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Button("Edit") { onConnect() }
                    .buttonStyle(.borderless)
                    .font(NTypography.caption)
            }
        } else {
            Button("Add keys") { onConnect() }
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        }
    }

    private func statusPill(_ text: String, color: Color) -> some View {
        Text(text)
            .font(NTypography.captionSmall)
            .foregroundStyle(color)
    }
}

// MARK: - Discovered connector row

/// One live connector the runtime can reach, with its real-time status. Reuses
/// CapabilityIconView (brand logos) by adapting the connector to a capability.
private struct DiscoveredConnectionRow: View {
    let connector: DiscoveredConnection

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(capability: iconCapability, size: 18, tint: theme.tokens.foreground)
                .frame(width: 24)

            Text(connector.displayName)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            statusView
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.md)
    }

    /// Adapt to the shape CapabilityIconView renders; the raw connector name as
    /// serverName lets CapabilityBrand match a brand logo (e.g. "…Slack").
    private var iconCapability: AgentCapability {
        AgentCapability(
            id: "conn:\(connector.name)", label: connector.displayName, description: "",
            icon: "puzzlepiece.extension", kind: "mcp", auth: ConnectionAuth.none,
            enabled: connector.isConnected, custom: true, requiredEnv: [], envReady: true,
            serverName: connector.name, status: connector.status
        )
    }

    @ViewBuilder
    private var statusView: some View {
        if connector.isConnected {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.tokens.success)
                Text("Connected")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        } else if connector.needsAuth {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.tokens.warning)
                Text("Sign in from Claude")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        } else {
            Text(connector.status.replacingOccurrences(of: "-", with: " ").capitalized)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }
}

struct CatalogConnectTarget: Identifiable {
    let entry: CapabilityCatalogEntry
    var id: String { entry.id }
}

extension CapabilityCatalogEntry {
    /// Adapt a catalog entry to the shape `CapabilityIconView` renders, so the
    /// same brand-logo logic covers both the agent page and Connections.
    var asCapability: AgentCapability {
        AgentCapability(
            id: id, label: label, description: description, icon: icon, kind: kind,
            auth: auth, enabled: envReady, custom: false,
            requiredEnv: requiredEnv, envReady: envReady, serverName: nil, status: nil
        )
    }
}

// MARK: - Connect sheet (global, no agent)

/// Collects a service's API keys and saves them to ~/.agent-server/.env. Unlike
/// the agent-page Connect flow, this doesn't enable a capability on any agent —
/// it just stores the keys so every agent that references them works.
struct ConnectServiceSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let entry: CapabilityCatalogEntry
    let onDone: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("Connect \(entry.label)")
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text("Stored privately in ~/.agent-server/.env.local — never inside an agent file.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(entry.requiredEnv, id: \.self) { key in
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text(key)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    if EnvFileStore.isSecretKey(key) {
                        SecureField("Paste value", text: binding(key))
                            .textFieldStyle(.roundedBorder)
                    } else {
                        TextField(key.hasSuffix("_URL") ? "https://…" : "Value", text: binding(key))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
                    .lineLimit(3)
            }

            HStack {
                Spacer()
                Button("Cancel") { onDone() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    save()
                } label: {
                    if busy { ProgressView().controlSize(.small) } else { Text("Save") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(busy || !allFilled)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 420)
        .background(theme.tokens.background)
    }

    private var allFilled: Bool {
        entry.requiredEnv.allSatisfy { !(values[$0] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    private func save() {
        busy = true
        errorMessage = nil
        Task {
            do {
                var trimmed: [String: String] = [:]
                for key in entry.requiredEnv {
                    trimmed[key] = (values[key] ?? "").trimmingCharacters(in: .whitespaces)
                }
                try monitor.saveConnectionKeys(trimmed)
                busy = false
                onDone()
            } catch {
                busy = false
                errorMessage = "Could not save keys: \(error.localizedDescription)"
            }
        }
    }
}
