import SwiftUI
import NerdsUI
import AppKit

/// Slide-in drawer that overlays the main pane from the left edge of the main
/// area (x=240). Width 780, full remaining height. Contains `Definition` and
/// `Runs` tabs condensed from the existing AgentDetail views.
struct AgentDetailDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String

    @Environment(\.nTheme) private var theme
    @State private var tab: Tab = .definition
    @State private var dragOffset: CGFloat = 0
    @State private var panelRuns: [Run] = []

    private let panelClient = PanelClient.fromEnv()

    static let width: CGFloat = 780
    static let slideDuration: Double = 0.22
    static let dismissThreshold: CGFloat = 80

    enum Tab: String, CaseIterable {
        case definition = "Definition"
        case runs = "Runs"
    }

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            VStack(spacing: 0) {
                header
                Divider().opacity(0.3)
                content
            }

            grabBar
        }
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(theme.tokens.background)
        .overlay(leadingBorder, alignment: .leading)
        // Rasterize the whole drawer as one layer BEFORE the shadow. Without
        // this, SwiftUI draws the shadow per opaque subview inside the
        // drawer (section containers, the markdown card), producing visible
        // inner drop-shadows that shouldn't be there.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 20, x: -8, y: 0)
        .offset(x: dragOffset)
        .task(id: agentId) {
            await fetchPanelRunsForStats()
        }
    }

    /// Pull this agent's history from the panel so the Definition tab's
    /// stats strip can render avg duration and total cost even for runs the
    /// local server never persisted those fields for. Silent on offline /
    /// panel-not-configured — the local data path still works.
    private func fetchPanelRunsForStats() async {
        guard let panelClient, let agent else {
            panelRuns = []
            return
        }
        do {
            let fetched = try await panelClient.fetchRuns(agent: agent.name, limit: 200)
            panelRuns = fetched.map { $0.toRun(agentId: agent.id) }
        } catch {
            panelRuns = []
        }
    }

    /// Vertical 4pt grab bar glued to the right edge. Dragging it leftward
    /// follows the drawer; release past `dismissThreshold` closes.
    private var grabBar: some View {
        ZStack {
            Rectangle()
                .fill(theme.tokens.border.opacity(0.5))
                .frame(width: 4)
                .frame(maxHeight: .infinity)

            // Three stacked dots as an affordance so the bar reads as a handle.
            VStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle()
                        .fill(theme.tokens.mutedForeground.opacity(0.6))
                        .frame(width: 3, height: 3)
                }
            }
        }
        .frame(width: 12)
        .contentShape(Rectangle())
        .onHover { inside in
            if inside {
                NSCursor.resizeLeftRight.push()
            } else {
                NSCursor.pop()
            }
        }
        .gesture(grabBarDragGesture)
    }

    private var grabBarDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                // Clamp: only allow leftward movement, bounded by drawer width.
                let raw = value.translation.width
                dragOffset = max(-Self.width, min(0, raw))
            }
            .onEnded { value in
                let translation = value.translation.width
                if shouldDismissOnRelease(
                    translation: translation,
                    threshold: Self.dismissThreshold,
                    axis: .horizontalLeading
                ) {
                    withAnimation(.easeOut(duration: Self.slideDuration)) {
                        dragOffset = -Self.width
                    }
                    router.close()
                } else {
                    withAnimation(.easeOut(duration: 0.18)) {
                        dragOffset = 0
                    }
                }
            }
    }

    private var leadingBorder: some View {
        Rectangle()
            .fill(theme.tokens.border)
            .frame(width: 1)
    }

    private var header: some View {
        HStack(spacing: NSpacing.md) {
            Button(action: router.close) {
                Image(systemName: "chevron.left")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut("w", modifiers: .command)
            .help("Close drawer (⌘W)")

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(agent?.name ?? agentId)
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                if let description = agent?.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(2)
                }
            }

            Spacer()

            tabs
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { option in
                Button {
                    tab = option
                } label: {
                    Text(option.rawValue)
                        .font(NTypography.bodySmall)
                        .fontWeight(.medium)
                        .foregroundStyle(tab == option ? theme.tokens.foreground : theme.tokens.mutedForeground)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .background(tab == option ? theme.tokens.muted : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .definition:
            definitionView
        case .runs:
            runsView
        }
    }

    private var definitionView: some View {
        // Non-scrolling vertical stack so the markdown editor can grow to fill
        // the remaining drawer height. runNow + stats + trigger/schedule/tools
        // stay pinned at the top; the prompt section expands to bottom.
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            if let agent {
                runNowRow(for: agent)
                statStripBox(for: agent)
                promptSection(for: agent)
                    .frame(maxHeight: .infinity)
            } else {
                Text("Agent not found.")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .padding(NSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Nine-column stat strip matching the web AgentStatStrip: first row is
    /// run-history stats (Total runs, Success rate, Avg duration, Total cost,
    /// Last run, Next run), second row is agent definition (Trigger, Schedule,
    /// Tools). One bordered container, divider between rows.
    @ViewBuilder
    private func statStripBox(for agent: Agent) -> some View {
        let stats = computeAgentStats(for: agent)
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                statColumn(title: "Total runs", value: stats.totalRuns)
                Divider().frame(height: 36)
                statColumn(title: "Success rate", value: stats.successRate)
                Divider().frame(height: 36)
                statColumn(title: "Avg duration", value: stats.avgDuration)
                Divider().frame(height: 36)
                statColumn(title: "Total cost", value: stats.totalCost)
                Divider().frame(height: 36)
                statColumn(title: "Last run", value: stats.lastRun)
                Divider().frame(height: 36)
                statColumn(title: "Next run", value: stats.nextRun, emphasize: stats.nextRun != "—")
            }
            .padding(NSpacing.md)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                statColumn(title: "Trigger", value: agent.kind.label)
                Divider().frame(height: 36)
                statColumn(
                    title: "Schedule",
                    value: agent.schedule.map { CronEnglishFormatter.describe($0) } ?? "—"
                )
                Divider().frame(height: 36)
                statColumn(
                    title: "Tools",
                    value: agent.tools.isEmpty ? "—" : agent.tools.joined(separator: ", ")
                )
            }
            .padding(NSpacing.md)
        }
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    private func statColumn(title: String, value: String, emphasize: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xxxs) {
            Text(title.uppercased())
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(value)
                .font(NTypography.bodySmall)
                .fontWeight(.semibold)
                .foregroundStyle(emphasize ? theme.tokens.primary : theme.tokens.foreground)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, NSpacing.sm)
    }

    private struct AgentStatsValues {
        let totalRuns: String
        let successRate: String
        let avgDuration: String
        let totalCost: String
        let lastRun: String
        let nextRun: String
    }

    private func computeAgentStats(for agent: Agent) -> AgentStatsValues {
        // Runs seeded from the panel use panel's task_id (UUID) as agentId —
        // that won't match the local slug. Fall back to matching by agent
        // display name so history shows up regardless of the id keyspace.
        let localRuns = monitor.recentRuns.filter {
            $0.agentId == agent.id || $0.agentName == agent.name
        }

        // Merge in panel-fetched runs (they have authoritative duration/cost
        // for historical completions that the local server may not have
        // persisted). Dedupe by runId so a run that exists in both only
        // counts once, preferring panel data for cost/duration when the
        // local record is missing those fields.
        let localById = Dictionary(uniqueKeysWithValues: localRuns.map { ($0.runId, $0) })
        var mergedById: [String: Run] = localById
        for panelRun in panelRuns where panelRun.agentId == agent.id || panelRun.agentName == agent.name {
            if let existing = mergedById[panelRun.runId] {
                mergedById[panelRun.runId] = Run(
                    runId: existing.runId,
                    agentId: existing.agentId,
                    agentName: existing.agentName,
                    status: existing.status,
                    startedAt: existing.startedAt,
                    completedAt: existing.completedAt ?? panelRun.completedAt,
                    summary: existing.summary ?? panelRun.summary,
                    error: existing.error ?? panelRun.error,
                    turnCount: existing.turnCount > 0 ? existing.turnCount : panelRun.turnCount,
                    toolsUsed: existing.toolsUsed.isEmpty ? panelRun.toolsUsed : existing.toolsUsed,
                    filesRead: existing.filesRead.isEmpty ? panelRun.filesRead : existing.filesRead,
                    filesWritten: existing.filesWritten.isEmpty ? panelRun.filesWritten : existing.filesWritten,
                    commandsRun: existing.commandsRun.isEmpty ? panelRun.commandsRun : existing.commandsRun,
                    progressMessages: existing.progressMessages,
                    accomplishments: existing.accomplishments.isEmpty ? panelRun.accomplishments : existing.accomplishments,
                    observations: existing.observations.isEmpty ? panelRun.observations : existing.observations,
                    trigger: existing.trigger ?? panelRun.trigger,
                    model: existing.model ?? panelRun.model,
                    inputTokens: existing.inputTokens ?? panelRun.inputTokens,
                    outputTokens: existing.outputTokens ?? panelRun.outputTokens,
                    estimatedCostUsd: (existing.estimatedCostUsd ?? 0) > 0 ? existing.estimatedCostUsd : panelRun.estimatedCostUsd,
                    durationMs: existing.durationMs ?? panelRun.durationMs,
                    conversationId: existing.conversationId ?? panelRun.conversationId
                )
            } else {
                mergedById[panelRun.runId] = panelRun
            }
        }
        let runs = Array(mergedById.values)

        let total = runs.count
        let terminal = runs.filter { $0.status != .running }
        let completed = terminal.filter { $0.status == .completed }
        let successPct: String = {
            guard !terminal.isEmpty else { return "—" }
            let r = Double(completed.count) / Double(terminal.count)
            return "\(Int(round(r * 100)))%"
        }()
        let avgDurationMs: Double? = {
            let ds = runs.compactMap { $0.durationMs.map(Double.init) }
            guard !ds.isEmpty else { return nil }
            return ds.reduce(0, +) / Double(ds.count)
        }()
        let totalCost = runs.compactMap { $0.estimatedCostUsd }.reduce(0.0, +)
        let lastRunStr: String = {
            guard let latest = runs.max(by: { $0.startedAt < $1.startedAt }) else { return "—" }
            return latest.startedAt.formatted(.relative(presentation: .numeric))
        }()
        let nextRunStr: String = {
            guard let schedule = agent.schedule,
                  let next = CronNextFire.next(schedule, after: Date()) else { return "—" }
            return next.formatted(.relative(presentation: .numeric))
        }()
        return AgentStatsValues(
            totalRuns: "\(total)",
            successRate: successPct,
            avgDuration: avgDurationMs.map(formatDurationMs) ?? "—",
            totalCost: totalCost > 0 ? String(format: "$%.2f", totalCost) : "—",
            lastRun: lastRunStr,
            nextRun: nextRunStr
        )
    }

    private func formatDurationMs(_ ms: Double) -> String {
        let s = ms / 1000
        if s < 60 { return String(format: "%.0fs", s) }
        if s < 3600 { return String(format: "%.0fm %.0fs", (s / 60).rounded(.down), s.truncatingRemainder(dividingBy: 60)) }
        let h = (s / 3600).rounded(.down)
        let m = (s.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down)
        return String(format: "%.0fh %.0fm", h, m)
    }

    /// Prompt section. The `AgentPromptEditor` owns its own top header row
    /// (PROMPT (filename) + Enabled toggle) so this wrapper has no extra
    /// label. Falls back to a plain text view when we can't resolve the
    /// source file.
    @ViewBuilder
    private func promptSection(for agent: Agent) -> some View {
        let fileURL = AgentFile.find(agentId: agent.id)?.url
        if let fileURL {
            AgentPromptEditor(fileURL: fileURL)
                .id(fileURL)
                .frame(maxHeight: .infinity)
        } else {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("PROMPT")
                    .font(NTypography.labelSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                ScrollView {
                    Text(agent.prompt)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var runsView: some View {
        // Full AgentRunsView (list + RunDetailView) instead of the old
        // active-runs-only stub that rendered 'No active runs.' when
        // nothing was in-flight.
        AgentRunsView(agentId: agentId, monitor: monitor)
    }


    /// Primary action row at the top of the definition view. Big gold
    /// Run button triggers the agent, disabled while it's actively running.
    @ViewBuilder
    private func runNowRow(for agent: Agent) -> some View {
        let running = monitor.activeRuns.contains { $0.agentId == agent.id }
        HStack(spacing: NSpacing.sm) {
            Button {
                monitor.triggerRun(agentId: agent.id)
            } label: {
                HStack(spacing: NSpacing.xs) {
                    if running {
                        ProgressView().controlSize(.mini).tint(theme.tokens.primaryForeground)
                    } else {
                        Image(systemName: "play.fill")
                    }
                    Text(running ? "Running…" : "Run now")
                        .font(NTypography.bodyMedium)
                        .fontWeight(.semibold)
                }
                .padding(.horizontal, NSpacing.md)
                .padding(.vertical, NSpacing.xs)
                .foregroundStyle(theme.tokens.primaryForeground)
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.primary)
                )
            }
            .buttonStyle(.plain)
            .disabled(running || !agent.enabled)

            if !agent.enabled {
                Text("Disabled")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.horizontal, NSpacing.xs)
                    .padding(.vertical, 2)
                    .background(theme.tokens.muted)
                    .clipShape(Capsule())
            }
            Spacer()
        }
    }

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(title.uppercased())
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            content()
        }
    }
}
