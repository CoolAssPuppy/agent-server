import SwiftUI
import NerdsUI
import AppKit

/// Settings drawer that slides down from the top edge of the main window
/// (below the titlebar). Full width, content height. Three side-by-side cards:
/// General, Panel connections, Updates.
struct SettingsDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme
    @StateObject private var connections: ConnectionsStore = SettingsDrawer.loadConnections()
    @State private var dragOffset: CGFloat = 0
    @State private var launchAtLogin: Bool = LaunchAtLoginManager.shared.isEnabled
    @State private var resumeAfterWake: Bool = true
    @State private var autoUpdates: Bool = true

    static let height: CGFloat = 440
    static let slideDuration: Double = 0.26

    private static let connectionsPath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".agent-server/connections.json")
    }()

    static func loadConnections() -> ConnectionsStore {
        let url = Self.connectionsPath
        guard let data = try? Data(contentsOf: url),
              let store = try? ConnectionsStore.from(jsonData: data) else {
            return ConnectionsStore()
        }
        return store
    }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header
            Divider().opacity(0.3)
            content
            Divider().opacity(0.3)
            footer
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        .background(theme.tokens.background)
        .shadow(color: Color.black.opacity(0.3), radius: 20, x: 0, y: 8)
        .offset(y: dragOffset)
        .gesture(dragGesture)
        .onKeyPress(.escape) {
            router.close()
            return .handled
        }
    }

    private var dragHandle: some View {
        Capsule()
            .fill(theme.tokens.mutedForeground.opacity(0.4))
            .frame(width: 48, height: 4)
            .padding(.top, NSpacing.xs)
            .padding(.bottom, NSpacing.xs)
    }

    private var header: some View {
        HStack {
            Text("Settings")
                .font(NTypography.titleLarge)
                .fontWeight(.semibold)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Button(action: router.close) {
                Image(systemName: "xmark")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.vertical, NSpacing.sm)
    }

    private var content: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            generalCard
            panelConnectionsCard
            updatesCard
        }
        .padding(NSpacing.xxl)
    }

    private var footer: some View {
        HStack {
            Text("Agent Server · Strategic Nerds")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.vertical, NSpacing.xs)
    }

    // MARK: - Cards

    private var generalCard: some View {
        SettingsCard(title: "General") {
            Toggle("Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, newValue in
                    LaunchAtLoginManager.shared.isEnabled = newValue
                }
                .font(NTypography.bodySmall)

            Toggle("Resume after wake", isOn: $resumeAfterWake)
                .font(NTypography.bodySmall)

            settingsRow(label: "Agents folder", value: agentsFolderDisplay)
            settingsRow(label: "Server status", value: monitor.isServerReachable ? "Online" : "Offline")
            settingsRow(label: "SSE stream", value: sseStatusText)
        }
    }

    private var panelConnectionsCard: some View {
        SettingsCard(title: "Panel connections") {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                ForEach($connections.entries) { $entry in
                    connectionRow($entry)
                }
                Button {
                    connections.append()
                } label: {
                    Label("Add connection", systemImage: "plus")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.primary)
                }
                .buttonStyle(.plain)
                .padding(.top, NSpacing.xxs)

                if !connections.allKeysValid {
                    Text("Keys must match `[A-Z][A-Z0-9_]*`.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.destructive)
                }
                if !connections.hasRequiredPanelPair {
                    Text("SSE paused — add AGENT_SERVER_PANEL_URL + AGENT_SERVER_PANEL_API_KEY.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            .onChange(of: connections.entries) { _, _ in
                persistConnections()
            }
        }
    }

    private func connectionRow(_ entry: Binding<ConnectionEntry>) -> some View {
        HStack(spacing: NSpacing.xs) {
            TextField("KEY", text: entry.key)
                .textFieldStyle(.roundedBorder)
                .font(NTypography.captionSmall)
                .frame(maxWidth: 150)
            Group {
                if ConnectionsStore.isSecretKey(entry.wrappedValue.key) {
                    HStack(spacing: NSpacing.xxs) {
                        Text(ConnectionsStore.maskedValue(
                            key: entry.wrappedValue.key,
                            value: entry.wrappedValue.value
                        ))
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.foreground)
                        Spacer()
                    }
                    .padding(.horizontal, NSpacing.xs)
                    .padding(.vertical, 3)
                    .background(theme.tokens.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
                } else {
                    TextField("value", text: entry.value)
                        .textFieldStyle(.roundedBorder)
                        .font(NTypography.captionSmall)
                }
            }
            Button {
                connections.remove(id: entry.wrappedValue.id)
            } label: {
                Image(systemName: "minus.circle")
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .buttonStyle(.plain)
        }
    }

    private var updatesCard: some View {
        SettingsCard(title: "Updates") {
            Toggle("Auto-update", isOn: $autoUpdates)
                .font(NTypography.bodySmall)
            settingsRow(label: "Version", value: version)
            settingsRow(label: "Agents loaded", value: "\(monitor.agents.count)")
            Button {
                UpdaterManager.shared.checkForUpdates()
            } label: {
                Text("Check for updates…")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.primary)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Helpers

    private func settingsRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(value)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    private var agentsFolderDisplay: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "~/.agent-server/agents".replacingOccurrences(of: "~", with: home)
    }

    private var sseStatusText: String {
        if !connections.hasRequiredPanelPair { return "Paused" }
        return monitor.isServerReachable ? "Connected" : "Reconnecting"
    }

    private var version: String {
        let infoDict = Bundle.main.infoDictionary
        let short = infoDict?["CFBundleShortVersionString"] as? String ?? "0.0"
        let build = infoDict?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }

    private func persistConnections() {
        guard connections.allKeysValid else { return }
        let url = Self.connectionsPath
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard let data = try? connections.toJSONData() else { return }
        try? data.write(to: url, options: .atomic)
    }

    // MARK: - Drag gesture

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                dragOffset = min(0, value.translation.height).magnitude > 0
                    ? max(0, value.translation.height)
                    : 0
                if value.translation.height < 0 {
                    dragOffset = max(value.translation.height, -20)
                } else {
                    dragOffset = value.translation.height
                }
            }
            .onEnded { value in
                if value.translation.height > 80 {
                    withAnimation(.easeOut(duration: Self.slideDuration)) {
                        dragOffset = -Self.height
                    }
                    router.close()
                } else {
                    withAnimation(.easeOut(duration: 0.18)) {
                        dragOffset = 0
                    }
                }
            }
    }
}

// MARK: - Card container

private struct SettingsCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title)
                .font(NTypography.titleSmall)
                .fontWeight(.semibold)
                .foregroundStyle(theme.tokens.foreground)
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                content()
            }
            Spacer(minLength: 0)
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
