import SwiftUI
import NerdsUI
import AppKit

/// Settings drawer (mock 3NT-1). Pulls down over the main pane from the top
/// edge of the window. Three flat cards side by side: General,
/// Panel connections, Updates. Panel connections edits `~/.agent-server/.env`
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
    @State private var autoUpdates: Bool = true
    @State private var didLoad: Bool = false

    static let height: CGFloat = 500
    static let slideDuration: Double = 0.26

    private static let envPath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".agent-server/.env")
    }()

    var body: some View {
        VStack(spacing: 0) {
            header
            content
            footer
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        // Distinct surface color so the drawer reads as its own layer.
        .background(theme.tokens.card)
        .clipShape(BottomRoundedRectangle(radius: NRadius.md))
        // Rasterize before shadow so the drawer draws one soft edge, not
        // a per-card bleed-through.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 16, x: 0, y: 6)
        .onKeyPress(.escape) {
            router.close()
            return .handled
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            loadPairs()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top) {
            Text("Settings")
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
                .padding(.top, NSpacing.xs)

            Spacer()

            Button(action: router.close) {
                ZStack {
                    Circle()
                        .fill(theme.tokens.muted)
                        .overlay(
                            Circle().stroke(theme.tokens.border, lineWidth: 1)
                        )
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .frame(width: 28, height: 28)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close settings")
        }
        .padding(.horizontal, NSpacing.xxl)
        // Reserve space for the transparent titlebar's traffic lights.
        // The drawer covers the titlebar area, so the Settings title and
        // ✕ close need to sit below the traffic light row.
        .padding(.top, 40)
        .padding(.bottom, NSpacing.md)
    }

    private var content: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            generalCard
            panelConnectionsCard
            updatesCard
        }
        .padding(.horizontal, NSpacing.xxl)
    }

    private var footer: some View {
        HStack {
            Text("© 2026 Strategic Nerds, Inc. · Made with love in Lisbon, Portugal.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            Spacer()

            // Tip jar — bottom right. Clicking opens Venmo.
            Button(action: openVenmo) {
                HStack(spacing: 4) {
                    Text("Don't forget to tip your developer. Venmo ")
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Text("@coolasspuppy")
                        .foregroundStyle(theme.tokens.primary)
                        .underline()
                }
                .font(NTypography.captionSmall)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Open Venmo tip link")
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.vertical, NSpacing.md)
    }

    private func openVenmo() {
        guard let url = URL(string: "https://venmo.com/u/coolasspuppy") else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: - Cards

    private var generalCard: some View {
        SettingsCard(title: "General") {
            settingsToggle("Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, newValue in
                    LaunchAtLoginManager.shared.isEnabled = newValue
                }

            settingsToggle("Resume scheduled agents after wake", isOn: $resumeAfterWake)

            settingsRow(label: "Agents folder") {
                Text(agentsFolderDisplay)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            settingsRow(label: "Server status") {
                statusPill(
                    isHealthy: monitor.isServerReachable,
                    label: monitor.isServerReachable ? "Running" : "Offline"
                )
            }

            settingsRow(label: "SSE stream") {
                statusPill(
                    isHealthy: monitor.isServerReachable && hasRequiredPanelPair,
                    label: sseStatusText
                )
            }
        }
    }

    private var panelConnectionsCard: some View {
        SettingsCard(title: "Panel connections") {
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
                    .frame(maxHeight: 200)
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
                if !hasRequiredPanelPair {
                    Text("SSE paused · add AGENT_SERVER_PANEL_URL + AGENT_SERVER_PANEL_API_KEY.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
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


    private var updatesCard: some View {
        SettingsCard(title: "Updates") {
            settingsToggle("Automatically check for updates", isOn: $autoUpdates)

            settingsRow(label: "Current version") {
                Text(version)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(theme.tokens.foreground)
            }

            settingsRow(label: "Agents loaded") {
                Text("\(monitor.agents.count)")
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

    private var hasRequiredPanelPair: Bool {
        let keys = Set(pairs.map(\.key))
        return keys.contains("AGENT_SERVER_PANEL_URL")
            && keys.contains("AGENT_SERVER_PANEL_API_KEY")
    }

    private var agentsFolderDisplay: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.agent-server/agents"
    }

    private var sseStatusText: String {
        if !hasRequiredPanelPair { return "Paused" }
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
            pairs = try EnvFileStore.load(from: Self.envPath)
        } catch {
            pairs = []
            saveError = "Could not load \(Self.envPath.lastPathComponent): \(error.localizedDescription)"
        }
        refreshValidation()
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
            try EnvFileStore.save(nonEmpty, to: Self.envPath)
            saveError = nil
        } catch EnvFileStoreError.invalidKey(let key) {
            saveError = "Invalid key: \(key)"
        } catch {
            saveError = "Could not save .env: \(error.localizedDescription)"
        }
    }
}

// MARK: - Card container (flat: border + card fill, no shadows)

private struct SettingsCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.tokens.mutedForeground)
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
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

// MARK: - Bottom-only rounded rectangle

private struct BottomRoundedRectangle: Shape {
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
