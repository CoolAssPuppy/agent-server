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
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    greeting
                    cardsGrid
                }
                // Match the sidebar's header top padding (NSpacing.md) so
                // the greeting sits on the same horizontal line as the
                // "Agents" header. Sides use NSpacing.xxl for breathing room.
                .padding(.horizontal, NSpacing.xxl)
                .padding(.top, NSpacing.md)
                .padding(.bottom, NSpacing.xxl)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            footer
        }
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

private struct MainPaneCard<Content: View>: View {
    let title: String
    let subtitle: String?
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

    var body: some View {
        MainPaneCard(
            title: "Tasks planned today",
            subtitle: nil
        ) {
            let scheduled = agents.filter { $0.isScheduled }
            if scheduled.isEmpty {
                Text("Nothing scheduled.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(scheduled.prefix(4)) { agent in
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
    let agentName: String
    let runStartedAt: Date
    let url: URL?
}

/// Aggregates links + filesWritten across recent runs and renders the
/// latest ~8 as artifact rows. Panel-side has a richer URL extractor
/// (extractOutputLinks) — on macOS we rely on the daemon's Run payload,
/// specifically `filesWritten` and any URLs parseable from result.summary.
private func extractArtifacts(runs: [Run], agents: [Agent], limit: Int) -> [ArtifactRow] {
    let agentName: [String: String] = Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0.name) })
    var rows: [ArtifactRow] = []

    for run in runs {
        let owner = agentName[run.agentId] ?? run.agentId

        // URLs extracted from the summary text.
        if let summary = run.summary {
            let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
            let range = NSRange(summary.startIndex..<summary.endIndex, in: summary)
            detector?.enumerateMatches(in: summary, range: range) { match, _, _ in
                if let url = match?.url {
                    rows.append(ArtifactRow(
                        id: "\(run.runId):\(url.absoluteString)",
                        label: url.host ?? url.absoluteString,
                        agentName: owner,
                        runStartedAt: run.startedAt,
                        url: url
                    ))
                }
            }
        }

        // Files the run wrote.
        for file in run.filesWritten {
            let leaf = (file as NSString).lastPathComponent
            rows.append(ArtifactRow(
                id: "\(run.runId):\(file)",
                label: leaf,
                agentName: owner,
                runStartedAt: run.startedAt,
                url: URL(fileURLWithPath: file)
            ))
        }
    }

    return Array(rows.prefix(limit))
}

private struct ArtifactsCard: View {
    let runs: [Run]
    let agents: [Agent]

    @Environment(\.nTheme) private var theme

    var body: some View {
        let items = extractArtifacts(runs: runs, agents: agents, limit: 8)
        MainPaneCard(title: "Artifacts", subtitle: nil) {
            if items.isEmpty {
                Text("No artifacts yet.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(items) { item in
                        artifactRow(item)
                    }
                }
            }
        }
    }

    private func artifactRow(_ item: ArtifactRow) -> some View {
        HStack(spacing: NSpacing.sm) {
            Image(systemName: "doc.text")
                .font(.system(size: 11))
                .foregroundStyle(theme.tokens.mutedForeground)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.label)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                Text(item.agentName)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
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

    private var agentNameById: [String: String] {
        Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0.name) })
    }

    var body: some View {
        MainPaneCard(
            title: "Feed",
            subtitle: "last \(min(runs.count, 10))"
        ) {
            if runs.isEmpty {
                Text("No recent activity.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(runs.prefix(10), id: \.runId) { run in
                        HStack(spacing: NSpacing.sm) {
                            Circle()
                                .fill(run.status.displayColor)
                                .frame(width: 6, height: 6)
                            Text(agentNameById[run.agentId] ?? run.agentId)
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
            }
        }
    }
}
