import SwiftUI
import AgentServerDesignSystem

struct ConnectionSectionHeader: View {
    let section: ConnectionScreenSection

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxxs) {
            Text(section.title)
                .font(NTypography.labelMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text(section.explanation)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct ConnectionInsetGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.muted.opacity(0.28))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md, style: .continuous))
    }
}

struct CredentialConnectionRow: View {
    let row: ConnectionCredentialRow
    let catalogEntry: CapabilityCatalogEntry?
    let onAction: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(capability: iconCapability, size: 18, tint: theme.tokens.foreground)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: NSpacing.xs) {
                    Text(row.name)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                        .lineLimit(1)
                    ConnectionCategoryPill(category: .api)
                }
                Text("API key · \(row.status == .connected ? "Ready" : "Needs setup")")
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
        Button(row.action.title, action: onAction)
            .buttonStyle(.borderless)
            .font(NTypography.caption)
    }

    private var iconCapability: AgentCapability {
        AgentCapability(
            id: row.serviceId,
            label: row.name,
            description: "",
            icon: catalogEntry?.icon ?? "key",
            kind: "mcp",
            source: "configured_api",
            auth: .apiKey,
            enabled: row.status == .connected,
            custom: false,
            requiredEnv: row.requiredEnvironmentKeys,
            envReady: row.status == .connected,
            serverName: nil,
            status: nil
        )
    }
}

struct ConnectionRow: View {
    let entry: CapabilityCatalogEntry
    let onConnect: () -> Void

    @Environment(\.nTheme) private var theme

    private var isConnected: Bool { entry.envReady && !entry.requiredEnv.isEmpty }
    private var isKeyless: Bool { entry.requiredEnv.isEmpty }

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(capability: entry.asCapability, size: 18, tint: theme.tokens.foreground)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: NSpacing.xs) {
                    Text(entry.label)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                        .lineLimit(1)
                    ConnectionCategoryPill(category: entry.category)
                }
                Text("\(consumerMethod) · \(consumerReadiness)")
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
            statusText("Managed in Claude", color: theme.tokens.mutedForeground)
        } else if isKeyless {
            statusText("Included", color: theme.tokens.mutedForeground)
        } else {
            Button(isConnected ? "Manage" : "Set up", action: onConnect)
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        }
    }

    private var consumerMethod: String {
        entry.kind == "channel" ? "Messaging" : "Connected app"
    }

    private var consumerReadiness: String {
        if entry.auth == .oauth { return "Uses your Claude sign-in" }
        if isKeyless { return "Ready" }
        return isConnected ? "Ready" : "Needs setup"
    }

    private func statusText(_ text: String, color: Color) -> some View {
        Text(text)
            .font(NTypography.captionSmall)
            .foregroundStyle(color)
    }
}

struct DiscoveredConnectionRow: View {
    let connector: DiscoveredConnection

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            CapabilityIconView(capability: iconCapability, size: 18, tint: theme.tokens.foreground)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(connector.displayName)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                Text("Connected through Claude · \(readinessText)")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
            }
            Spacer()
            statusView
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.md)
    }

    private var iconCapability: AgentCapability {
        AgentCapability(
            id: "conn:\(connector.name)", label: connector.displayName, description: "",
            icon: "puzzlepiece.extension", kind: "mcp", source: "account",
            auth: ConnectionAuth.none,
            enabled: connector.isConnected, custom: true, requiredEnv: [], envReady: true,
            serverName: connector.name, status: connector.status
        )
    }

    @ViewBuilder
    private var statusView: some View {
        if connector.isConnected {
            Text("Managed in Claude")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        } else if connector.needsAuth {
            Text("Sign in with Claude")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        } else {
            Text(connector.status.replacingOccurrences(of: "-", with: " ").capitalized)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }

    private var readinessText: String {
        if connector.isConnected { return "Ready" }
        if connector.needsAuth { return "Needs sign-in" }
        return connector.status.replacingOccurrences(of: "-", with: " ").capitalized
    }
}

struct RuntimeConnectionRow: View {
    let presentation: RuntimeConnectionPresentation

    @Environment(\.nTheme) private var theme
    @State private var showsMcpServers = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: NSpacing.md) {
                Image(systemName: "terminal")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(theme.tokens.foreground)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(presentation.name)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    Text(presentation.authenticationSummary)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }

                Spacer()

                Text(presentation.statusTitle)
                    .font(NTypography.caption)
                    .foregroundStyle(
                        presentation.status == .installed
                            ? theme.tokens.success
                            : theme.tokens.mutedForeground
                    )
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(presentation.name), \(presentation.statusTitle), \(presentation.mcpCountTitle)")

            if presentation.status == .installed {
                Divider()
                    .opacity(0.25)
                    .padding(.leading, 24 + NSpacing.md)
                    .padding(.vertical, NSpacing.sm)

                if let notice = presentation.inventoryNotice {
                    Text(notice)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.error)
                        .padding(.leading, 24 + NSpacing.md)
                        .padding(.bottom, NSpacing.sm)
                }

                if let emptyMessage = presentation.emptyMcpMessage {
                    Text(emptyMessage)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .padding(.leading, 24 + NSpacing.md)
                } else {
                    DisclosureGroup(isExpanded: $showsMcpServers) {
                        VStack(spacing: NSpacing.sm) {
                            ForEach(presentation.mcpServers, id: \.name) { server in
                                runtimeMcpRow(server)
                            }
                        }
                        .padding(.top, NSpacing.sm)
                    } label: {
                        Text(presentation.mcpCountTitle)
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                    .padding(.leading, 24 + NSpacing.md)
                    .accessibilityValue(showsMcpServers ? "Expanded" : "Collapsed")
                }
            }
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.md)
    }

    private func runtimeMcpRow(_ server: RuntimeMcpServerPresentation) -> some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(server.name)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
            Spacer()
            Text(server.statusTitle)
                .font(NTypography.captionSmall)
                .foregroundStyle(runtimeMcpStatusColor(server.status))
        }
        .accessibilityElement(children: .combine)
    }

    private func runtimeMcpStatusColor(_ status: String) -> Color {
        switch status {
        case "connected": theme.tokens.success
        case "needs_auth", "failed": theme.tokens.error
        default: theme.tokens.mutedForeground
        }
    }
}

struct CatalogConnectTarget: Identifiable {
    let entry: CapabilityCatalogEntry
    var id: String { entry.id }
}

extension CapabilityCatalogEntry {
    var category: ConnectionCategory {
        ConnectionCategory(
            capabilityID: id,
            kind: kind,
            auth: auth?.rawValue ?? "none",
            source: nil
        )
    }

    var asCapability: AgentCapability {
        AgentCapability(
            id: id, label: label, description: description, icon: icon, kind: kind,
            source: nil,
            auth: auth, enabled: envReady, custom: false,
            requiredEnv: requiredEnv, envReady: envReady, serverName: nil, status: nil
        )
    }
}

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
                Text(entry.envReady ? "Modify \(entry.label)" : "Connect \(entry.label)")
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text("Stored privately in your Agent Server folder, never inside an agent file.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }

            ForEach(entry.requiredEnv, id: \.self) { key in
                credentialField(key)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button("Cancel", action: onDone)
                    .keyboardShortcut(.cancelAction)
                Button(action: save) {
                    if busy { ProgressView().controlSize(.small) } else { Text("Save") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(busy || !allFilled)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 420)
        .background(theme.tokens.background)
        .task { loadExistingValues() }
    }

    @ViewBuilder
    private func credentialField(_ key: String) -> some View {
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

    private var allFilled: Bool {
        entry.requiredEnv.allSatisfy { !(values[$0] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    private func loadExistingValues() {
        guard entry.envReady else { return }
        let environmentFile = AgentServerWorkspaceStore.current().environmentFile
        for key in entry.requiredEnv {
            if let value = try? EnvFileStore.value(forKey: key, from: environmentFile) {
                values[key] = value
            }
        }
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
                errorMessage = "Could not save connection: \(error.localizedDescription)"
            }
        }
    }
}
