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
                Text(row.action == .addAnother
                     ? "Add another account for this service"
                     : catalogEntry?.description ?? "Private service connection")
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
        if row.status == .connected {
            HStack(spacing: NSpacing.sm) {
                Label("Connected", systemImage: "checkmark.circle.fill")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.success)
                Button(row.action.title, action: onAction)
                    .buttonStyle(.borderless)
                    .font(NTypography.caption)
            }
        } else {
            Button(row.action.title, action: onAction)
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        }
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
            statusText("Sign in from Claude", color: theme.tokens.mutedForeground)
        } else if isKeyless {
            statusText("Built in", color: theme.tokens.mutedForeground)
        } else if isConnected {
            HStack(spacing: NSpacing.xs) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.tokens.success)
                Text("Connected")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Button("Edit", action: onConnect)
                    .buttonStyle(.borderless)
                    .font(NTypography.caption)
            }
        } else {
            Button("Set up", action: onConnect)
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        }
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
            HStack(spacing: NSpacing.xs) {
                Text(connector.displayName)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                ConnectionCategoryPill(category: .mcp)
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
