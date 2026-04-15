import SwiftUI
import NerdsUI

/// Main window content pane. Mirrors the Panel Home layout: greeting line
/// followed by a 2×2 grid of cards. No alert banner — the `Decisions (pending)`
/// card is the single source of truth for pending-decision UI.
struct MainPane: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme

    private var decisionsCount: Int {
        monitor.pendingDecisions.filter(\.isPending).count
    }

    private var runningCount: Int {
        monitor.activeRuns.count
    }

    var body: some View {
        // Non-scrolling main pane. Greeting + 2×2 card grid fill the window.
        // The Artifacts and Feed cards handle their own internal scroll when
        // content overflows, so the main window never needs a chrome scroller.
        VStack(alignment: .leading, spacing: NSpacing.xl) {
            greeting
            cardsGrid
                .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.top, NSpacing.md)
        .padding(.bottom, NSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        .background(theme.tokens.background)
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button {
                router.openSettings()
            } label: {
                // Size + typography matches the sidebar footer's
                // Open folder / New agent Labels so the gear sits on
                // the same horizontal baseline as those icons.
                Label("Settings", systemImage: "gearshape")
                    .labelStyle(.iconOnly)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Settings")
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
        .overlay(alignment: .top) {
            Divider().opacity(0.4)
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(greetingCopy)
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
            Text(subtitleCopy)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }

    private var greetingCopy: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good morning."
        case 12..<17: return "Good afternoon."
        case 17..<22: return "Good evening."
        default: return "Still up?"
        }
    }

    private var subtitleCopy: String {
        var parts: [String] = []
        if decisionsCount > 0 {
            parts.append("\(decisionsCount) decision\(decisionsCount == 1 ? "" : "s") waiting")
        }
        if runningCount > 0 {
            parts.append("\(runningCount) agent\(runningCount == 1 ? "" : "s") running")
        }
        return parts.isEmpty ? "All quiet." : parts.joined(separator: " · ")
    }

    private var cardsGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: NSpacing.lg),
                GridItem(.flexible(), spacing: NSpacing.lg),
            ],
            spacing: NSpacing.lg
        ) {
            DecisionsCard(decisions: monitor.pendingDecisions.filter(\.isPending))
            MyTasksTodayCard(agents: monitor.agents)
            ArtifactsCard(runs: monitor.recentRuns, agents: monitor.agents)
            FeedCard(runs: monitor.recentRuns, agents: monitor.agents)
        }
    }
}

// MARK: - Cards

private struct MainPaneCard<Accessory: View, Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder let accessory: () -> Accessory
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack {
                Text(title)
                    .font(NTypography.titleSmall)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.tokens.foreground)
                Spacer()
                if let subtitle {
                    Text(subtitle)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                accessory()
            }
            content()
            Spacer(minLength: 0)
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}

extension MainPaneCard where Accessory == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, accessory: { EmptyView() }, content: content)
    }
}

/// Time-window selector shared by Feed and Artifacts cards. 3 / 7 / 30 days.
private enum MainPaneWindow: Int, CaseIterable, Identifiable {
    case threeDays = 3
    case sevenDays = 7
    case thirtyDays = 30

    var id: Int { rawValue }
    var label: String { "\(rawValue)d" }
    var seconds: TimeInterval { TimeInterval(rawValue * 86_400) }
}

private struct MainPaneWindowPicker: View {
    @Binding var selection: MainPaneWindow

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: 0) {
            ForEach(MainPaneWindow.allCases) { option in
                Button {
                    selection = option
                } label: {
                    Text(option.label)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(
                            selection == option
                                ? theme.tokens.foreground
                                : theme.tokens.mutedForeground
                        )
                        .padding(.horizontal, NSpacing.xs)
                        .padding(.vertical, 2)
                        .background(
                            selection == option
                                ? theme.tokens.foreground.opacity(0.08)
                                : Color.clear
                        )
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(theme.tokens.foreground.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }
}

private struct DecisionsCard: View {
    let decisions: [Decision]

    @Environment(\.nTheme) private var theme

    var body: some View {
        MainPaneCard(
            title: "Decisions",
            subtitle: "\(decisions.count) pending"
        ) {
            if decisions.isEmpty {
                emptyState
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(decisions.prefix(4)) { decision in
                        decisionRow(decision)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        Text("No decisions waiting.")
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
    }

    private func decisionRow(_ decision: Decision) -> some View {
        HStack(spacing: NSpacing.sm) {
            Circle()
                .fill(theme.tokens.primary)
                .frame(width: 6, height: 6)
            Text(decision.title)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
            Spacer()
            Text(decision.relativeCreatedAt)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }
}

private struct MyTasksTodayCard: View {
    let agents: [Agent]

    @Environment(\.nTheme) private var theme

    /// Returns the agents to display and whether we fell through to tomorrow.
    /// Today's firings take priority; if empty and the local hour is >= 17
    /// we surface tomorrow's schedule so the evening view isn't empty.
    private var planned: (agents: [Agent], isTomorrow: Bool) {
        let now = Date()
        let today = agents.filter { agent in
            guard let schedule = agent.schedule else { return false }
            return CronNextFire.firesToday(schedule, now: now)
        }
        if !today.isEmpty {
            return (today, false)
        }
        let hour = Calendar.current.component(.hour, from: now)
        guard hour >= 17 else { return ([], false) }
        let tomorrow = agents.filter { agent in
            guard let schedule = agent.schedule else { return false }
            return CronNextFire.firesTomorrow(schedule, now: now)
        }
        return (tomorrow, !tomorrow.isEmpty)
    }

    var body: some View {
        let result = planned
        MainPaneCard(
            title: result.isTomorrow ? "Tasks planned tomorrow" : "Tasks planned today",
            subtitle: nil
        ) {
            if result.agents.isEmpty {
                Text("Nothing scheduled.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(result.agents.prefix(4)) { agent in
                        HStack(spacing: NSpacing.sm) {
                            Image(systemName: "clock")
                                .font(.system(size: NIconSize.sm))
                                .foregroundStyle(theme.tokens.mutedForeground)
                            Text(agent.name)
                                .font(NTypography.bodySmall)
                                .foregroundStyle(theme.tokens.foreground)
                                .lineLimit(1)
                            Spacer()
                            Text(agent.scheduleDisplay)
                                .font(NTypography.caption)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }
}

private struct ArtifactRow: Identifiable {
    let id: String
    let label: String
    let title: String?
    let agentName: String
    let runStartedAt: Date
    let url: URL?
}

/// Returns an SF Symbol name for the host backing this URL. We don't have
/// AppKit-renderable brand icons inside the daemon, but SF Symbols cover the
/// common cases well enough for a sidebar card. Falls back to a generic doc
/// icon when the host isn't recognized.
private func iconForArtifactURL(_ url: URL?) -> String {
    guard let host = url?.host?.lowercased() else { return "doc.text" }
    if host.contains("notion.so") || host.contains("notion.site") { return "n.square" }
    if host.contains("linear.app") { return "checklist" }
    if host.contains("github.com") { return "chevron.left.forwardslash.chevron.right" }
    if host.contains("slack.com") { return "number" }
    if host.contains("docs.google.com") { return "doc.text.fill" }
    if host.contains("sheets.google.com") { return "tablecells.fill" }
    if host.contains("slides.google.com") { return "rectangle.on.rectangle.fill" }
    if host.contains("figma.com") { return "paintbrush.pointed.fill" }
    if host.contains("atlassian") { return "j.square" }
    if host.contains("asana.com") { return "a.square" }
    if host.contains("trello.com") { return "rectangle.stack.fill" }
    return "link"
}

/// Local-first artifact extraction: produce a row per `filesWritten` entry
/// across recent runs. Panel-sourced URLs / artifact-table rows are merged on
/// top of this (not into it) so local wins any time the daemon has an answer.
private func extractLocalArtifacts(runs: [Run], agents: [Agent]) -> [ArtifactRow] {
    let agentNameById: [String: String] = Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0.name) })
    var rows: [ArtifactRow] = []

    for run in runs {
        let owner = agentNameById[run.agentId] ?? run.agentName
        for file in run.filesWritten {
            let leaf = (file as NSString).lastPathComponent
            rows.append(ArtifactRow(
                id: "\(run.runId):\(file)",
                label: leaf,
                title: nil,
                agentName: owner,
                runStartedAt: run.startedAt,
                url: URL(fileURLWithPath: file)
            ))
        }
    }

    return rows
}

/// Translate a panel-provided artifact into the local row shape. `kind ==
/// "artifact"` means a persisted file / upload and we surface the filename;
/// `kind == "link"` means a URL extracted by the panel from logs or run
/// summaries (authoritative — we do NOT re-extract client-side).
private func panelArtifactToRow(_ artifact: PanelArtifact) -> ArtifactRow? {
    let created = artifact.createdAt ?? Date()
    if artifact.kind == "link" {
        guard let urlString = artifact.url, let url = URL(string: urlString) else {
            return nil
        }
        let label = artifact.title ?? url.host ?? urlString
        return ArtifactRow(
            id: "panel-link:\(urlString)",
            label: label,
            title: artifact.agentName,
            agentName: artifact.agentName,
            runStartedAt: created,
            url: url
        )
    }
    let filename = artifact.filename ?? "Artifact"
    return ArtifactRow(
        id: "panel-artifact:\(artifact.id)",
        label: filename,
        title: artifact.agentName,
        agentName: artifact.agentName,
        runStartedAt: created,
        url: artifact.url.flatMap(URL.init(string:))
    )
}

private struct ArtifactsCard: View {
    let runs: [Run]
    let agents: [Agent]

    @Environment(\.nTheme) private var theme
    @State private var window: MainPaneWindow = .threeDays
    @State private var panelArtifacts: [PanelArtifact] = []
    @State private var panelFetchedOnce = false

    private let panelClient = PanelClient.fromEnv()

    private var filteredRuns: [Run] {
        let cutoff = Date().addingTimeInterval(-window.seconds)
        return runs.filter { $0.startedAt >= cutoff }
    }

    /// Merge local `filesWritten` rows with panel artifacts. Local-first:
    /// - File artifacts dedupe on `run.runId + path`.
    /// - URL artifacts dedupe on the absolute URL string.
    /// Local rows always win on conflict so the offline/daemon path is
    /// authoritative whenever it has data.
    private var mergedRows: [ArtifactRow] {
        let localRows = extractLocalArtifacts(runs: filteredRuns, agents: agents)

        var seenFileKeys = Set<String>()
        var seenUrls = Set<String>()
        for row in localRows {
            seenFileKeys.insert(row.id)
            if let url = row.url?.absoluteString { seenUrls.insert(url) }
        }

        var merged = localRows
        let cutoff = Date().addingTimeInterval(-window.seconds)
        for artifact in panelArtifacts {
            let ts = artifact.createdAt ?? Date()
            if ts < cutoff { continue }
            guard let row = panelArtifactToRow(artifact) else { continue }
            if let url = row.url?.absoluteString {
                if seenUrls.contains(url) { continue }
                seenUrls.insert(url)
            } else {
                if seenFileKeys.contains(row.id) { continue }
                seenFileKeys.insert(row.id)
            }
            merged.append(row)
        }

        merged.sort { $0.runStartedAt > $1.runStartedAt }
        return Array(merged.prefix(8))
    }

    var body: some View {
        MainPaneCard(
            title: "Artifacts",
            subtitle: nil,
            accessory: { MainPaneWindowPicker(selection: $window) }
        ) {
            let items = mergedRows
            if items.isEmpty {
                emptyState
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: NSpacing.xs) {
                        ForEach(items) { item in
                            artifactRow(item)
                        }
                    }
                    .padding(.bottom, NSpacing.lg)
                }
                .frame(maxHeight: 280)
            }
        }
        .task { await refreshPanelArtifacts() }
        .onChange(of: window) { _, _ in
            Task { await refreshPanelArtifacts() }
        }
        .onChange(of: runs.count) { _, _ in
            Task { await refreshPanelArtifacts() }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text("No artifacts yet.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            if panelClient == nil {
                Text("Configure Agent Panel to see artifacts from all runs.")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(2)
            }
        }
    }

    private func refreshPanelArtifacts() async {
        guard let panelClient else {
            panelFetchedOnce = true
            return
        }
        let fetched = await panelClient.fetchArtifacts(windowDays: window.rawValue)
        await MainActor.run {
            self.panelArtifacts = fetched
            self.panelFetchedOnce = true
        }
    }

    private func artifactRow(_ item: ArtifactRow) -> some View {
        // For http(s) URL artifacts the agent name reads as the primary
        // identifier (who produced this) with the URL's host underneath. For
        // file artifacts where there is no external host, the filename stays
        // primary with no secondary line.
        let isWeb = (item.url?.scheme == "http" || item.url?.scheme == "https")
        let primary = isWeb ? item.agentName : item.label
        let secondary: String? = isWeb ? (item.url?.host) : nil
        return HStack(spacing: NSpacing.sm) {
            Image(systemName: iconForArtifactURL(item.url))
                .font(.system(size: 11))
                .foregroundStyle(theme.tokens.mutedForeground)
            VStack(alignment: .leading, spacing: 1) {
                Text(primary)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                if let secondary {
                    Text(secondary)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let url = item.url { NSWorkspace.shared.open(url) }
        }
    }
}

private struct FeedCard: View {
    let runs: [Run]
    let agents: [Agent]

    @Environment(\.nTheme) private var theme
    @State private var window: MainPaneWindow = .threeDays

    private var agentNameById: [String: String] {
        Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0.name) })
    }

    private var filtered: [Run] {
        let cutoff = Date().addingTimeInterval(-window.seconds)
        return runs.filter { $0.startedAt >= cutoff }
    }

    var body: some View {
        MainPaneCard(
            title: "Feed",
            subtitle: nil,
            accessory: { MainPaneWindowPicker(selection: $window) }
        ) {
            let items = filtered
            if items.isEmpty {
                Text("No recent activity.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: NSpacing.xs) {
                        ForEach(items, id: \.runId) { run in
                            HStack(spacing: NSpacing.sm) {
                                Circle()
                                    .fill(run.status.displayColor)
                                    .frame(width: 6, height: 6)
                                Text(agentNameById[run.agentId] ?? run.agentName)
                                    .font(NTypography.bodySmall)
                                    .foregroundStyle(theme.tokens.foreground)
                                    .lineLimit(1)
                                Spacer()
                                Text(run.startedAt.formatted(.relative(presentation: .numeric)))
                                    .font(NTypography.captionSmall)
                                    .foregroundStyle(theme.tokens.mutedForeground)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .padding(.bottom, NSpacing.lg)
                }
                .frame(maxHeight: 280)
            }
        }
    }
}
