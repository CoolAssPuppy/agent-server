import SwiftUI
import AgentServerDesignSystem
import AppKit

/// Slide-in drawer that overlays the main pane from the left edge of the main
/// area (x=240). Width 780, full remaining height. Consumer-focused agent
/// page: schedule in plain English, the last run's outcome, editing, and run
/// history. One tab bar swaps those surfaces without opening nested drawers.
struct AgentDetailDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0
    @State private var detailState: AgentDetailPresentationState
    @State private var runState = AgentRunTriggerState.idle
    @State private var runRequestedAt: Date?

    static let width: CGFloat = 780
    static let slideDuration: Double = 0.22
    static let dismissThreshold: CGFloat = 80

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    init(monitor: StatusMonitor, router: DrawerRouter, agentId: String) {
        self.monitor = monitor
        self.router = router
        self.agentId = agentId
        _detailState = State(initialValue: AgentDetailPresentationState(agentId: agentId))
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            VStack(spacing: 0) {
                header
                Divider().opacity(0.3)
                tabBar
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
        // drawer, producing visible inner drop-shadows that shouldn't be there.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 20, x: -8, y: 0)
        .offset(x: dragOffset)
        .onChange(of: agentId) { _, selectedAgentId in
            detailState.selectAgent(id: selectedAgentId)
            runState = .idle
            runRequestedAt = nil
        }
        .onExitCommand(perform: router.close)
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
                    withAnimation(reduceMotion ? nil : .easeOut(duration: Self.slideDuration)) {
                        dragOffset = -Self.width
                    }
                    router.close()
                } else {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
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

    // MARK: - Header

    private var header: some View {
        AgentDetailHeader(
            name: agent?.name ?? agentId,
            description: agent?.description,
            schedule: agent?.scheduleDisplay,
            nextRun: nextRunDescription,
            run: headerRunPresentation,
            security: securityIndicator,
            onClose: router.close,
            onRun: startRun,
            onSecurity: { router.openSecurity(agentId: agentId) }
        )
    }

    private var nextRunDescription: String? {
        guard let schedule = agent?.schedule,
              let next = CronNextFire.next(schedule, after: Date()) else {
            return nil
        }
        return next.formatted(.relative(presentation: .numeric))
    }

    private var tabBar: some View {
        AgentDetailTabBar(
            selectedTab: detailState.selectedTab,
            onSelect: selectTab
        )
    }

    private func selectTab(_ tab: AgentDetailTab) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.16)) {
            detailState.select(tab)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let agent {
            switch detailState.selectedTab {
            case .recentRuns:
                recentRunsView(for: agent)
            case .editAgent:
                AgentSettingsSheet(
                    monitor: monitor,
                    agentId: agentId,
                    isPresented: .constant(true),
                    isEmbedded: true,
                    onFinished: { selectTab(.recentRuns) },
                    onDeleted: { router.close() }
                )
                .id(agentId)
            case .runHistory:
                AgentRunsView(
                    agentId: agentId,
                    monitor: monitor,
                    initiallySelectedRunId: detailState.selectedRunId
                )
                .id("\(agentId):\(detailState.selectedRunId ?? "latest")")
            }
        } else {
            Text("Agent not found.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func recentRunsView(for agent: Agent) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            if let feedback = runState.presentation {
                AgentRunFeedbackView(
                    state: runState,
                    feedback: feedback,
                    onRecover: recoverRun
                )
            }
            lastRunCard(for: agent)
                .frame(maxHeight: .infinity)
            capabilitiesStrip(for: agent)
        }
        .padding(NSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var missingConnectionCount: Int {
        (agent?.capabilities ?? []).count { capability in
            guard capability.enabled else { return false }
            let isMissingRequiredEnvironment = !capability.requiredEnv.isEmpty
                && !capability.envReady
            return isMissingRequiredEnvironment
                || capability.status == "needs-auth"
                || capability.status == "failed"
        }
    }

    private var securityIndicator: AgentDetailSecurityIndicatorPresentation {
        let result = monitor.securityDashboard?.agents.first(where: { $0.id == agentId })?.result
            ?? .pending
        return AgentDetailSecurityIndicatorPresentation(
            result: result,
            missingConnectionCount: missingConnectionCount
        )
    }

    private var isRunning: Bool {
        if runState.isStarting { return true }
        if monitor.activeRuns.contains(where: { $0.agentId == agentId }) { return true }
        guard let startedRunId = runState.startedRunId else { return false }
        return !monitor.recentRuns.contains { run in
            run.runId == startedRunId && run.status != .running
        }
    }

    private var headerRunPresentation: AgentDetailHeaderRunPresentation {
        AgentDetailHeaderRunPresentation(
            isAgentEnabled: agent?.enabled ?? false,
            isRunning: isRunning
        )
    }

    private func startRun() {
        guard let agent, !headerRunPresentation.isDisabled else { return }
        runRequestedAt = Date()
        runState = .starting
        Task {
            runState = await monitor.triggerRun(agentId: agent.id)
        }
    }

    private func recoverRun(_ recovery: AgentRunTriggerRecovery) {
        switch recovery {
        case .retry:
            startRun()
        case .openAgentSettings:
            selectTab(.editAgent)
        case .reviewSecurity:
            router.openSecurity(agentId: agentId)
        case .openRun:
            guard let runId = runState.startedRunId else { return }
            detailState.openRun(id: runId)
        case .checkStatus:
            guard let runRequestedAt else { return }
            runState = .starting
            Task {
                runState = await monitor.reconcileTriggeredRun(
                    agentId: agentId,
                    requestedAt: runRequestedAt
                )
            }
        }
    }

    // MARK: - Last run

    private var lastRun: Run? {
        guard let agent else { return nil }
        return monitor.recentRuns
            .filter { $0.agentId == agent.id || $0.agentName == agent.name }
            .max(by: { $0.startedAt < $1.startedAt })
    }

    @ViewBuilder
    private func lastRunCard(for agent: Agent) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(spacing: NSpacing.sm) {
                Text(AgentDetailPresentation.lastRunTitle)
                    .font(NTypography.labelSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer()
            }

            if let run = lastRun {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    HStack(spacing: NSpacing.xs) {
                        Image(systemName: statusIcon(for: run))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(statusColor(for: run))
                        Text(statusLine(for: run))
                            .font(NTypography.bodySmall)
                            .fontWeight(.medium)
                            .foregroundStyle(theme.tokens.foreground)
                        Spacer()
                    }

                    if let facts = runFacts(for: run) {
                        Text(facts)
                            .font(NTypography.captionSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }

                    if !run.filesWritten.isEmpty {
                        producedList(run.filesWritten)
                    }

                    if run.status == .failed, let error = run.error {
                        Text(error)
                            .font(NTypography.caption)
                            .foregroundStyle(.red)
                            .lineLimit(3)
                    }

                    if let summary = run.summary, !summary.isEmpty {
                        VStack(alignment: .leading, spacing: NSpacing.xxs) {
                            Text(AgentDetailPresentation.notesTitle)
                                .font(NTypography.labelSmall)
                                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
                            ScrollView {
                                MarkdownContentView(source: summary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.bottom, NSpacing.sm)
                            }
                            .frame(maxHeight: .infinity)
                        }
                    } else if run.status == .running {
                        Text("Running")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
            } else {
                Text("This agent hasn't run yet.")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .padding(NSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    private func statusIcon(for run: Run) -> String {
        switch run.status {
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .running: return "arrow.triangle.2.circlepath"
        case .skipped: return "minus.circle"
        }
    }

    private func statusColor(for run: Run) -> Color {
        switch run.status {
        case .completed: return theme.tokens.success
        case .failed: return theme.tokens.destructive
        case .running: return theme.tokens.primary
        case .skipped: return theme.tokens.mutedForeground
        }
    }

    private func statusLine(for run: Run) -> String {
        let when = run.startedAt.formatted(.relative(presentation: .numeric))
        switch run.status {
        case .completed: return "Succeeded \(when)"
        case .failed: return "Failed \(when)"
        case .running: return "Running now"
        case .skipped: return "Skipped \(when)"
        }
    }

    /// A concise, concrete facts line — how long it took and which model ran it —
    /// so the box leads with something real instead of the agent's monologue.
    private func runFacts(for run: Run) -> String? {
        var parts: [String] = []
        if let duration = run.duration {
            parts.append("Took \(formatDuration(duration))")
        }
        if let model = run.model, !model.isEmpty, model != "<synthetic>" {
            parts.append(prettyModel(model))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        if seconds < 1 { return "under a second" }
        if seconds < 60 { return "\(Int(seconds.rounded()))s" }
        let minutes = Int(seconds) / 60
        let rem = Int(seconds) % 60
        return rem == 0 ? "\(minutes)m" : "\(minutes)m \(rem)s"
    }

    private func prettyModel(_ model: String) -> String {
        let lower = model.lowercased()
        if lower.contains("opus") { return "Claude Opus" }
        if lower.contains("sonnet") { return "Claude Sonnet" }
        if lower.contains("haiku") { return "Claude Haiku" }
        if lower.contains("kimi") { return ModelDisplayName.format(model) }
        if lower.contains("gpt") || lower.contains("codex") { return "Codex" }
        return model
    }

    /// What the run actually produced — the concrete deliverable, named plainly.
    private func producedList(_ files: [String]) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text(AgentDetailPresentation.producedTitle)
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
            ForEach(files.prefix(6), id: \.self) { file in
                HStack(spacing: NSpacing.xs) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Text((file as NSString).lastPathComponent)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.foreground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }

    // MARK: - Capabilities strip

    @ViewBuilder
    private func capabilitiesStrip(for agent: Agent) -> some View {
        let capabilities = agent.capabilities ?? []
        let enabled = capabilities.filter(\.enabled)
        let offCount = capabilities.count - enabled.count

        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(AgentDetailPresentation.capabilitiesTitle)
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            if enabled.isEmpty {
                Text("No capabilities enabled")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                CapabilitySummary(
                    capabilities: enabled,
                    trailing: offCount > 0 ? "+\(offCount) off" : nil
                )
            }
        }
    }
}

/// Compact icon-and-text summary. Exact permissions stay in agent settings.
private struct CapabilitySummary: View {
    let capabilities: [AgentCapability]
    let trailing: String?

    @Environment(\.nTheme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: NSpacing.xs) {
                ForEach(capabilities) { capability in
                    HStack(spacing: NSpacing.xxs) {
                        CapabilityIconView(capability: capability, size: 12, tint: theme.tokens.foreground)
                        Text(capability.label)
                            .font(NTypography.caption)
                    }
                    .foregroundStyle(theme.tokens.foreground)
                    .padding(.vertical, NSpacing.xxs)
                    if capability.id != capabilities.last?.id {
                        Divider()
                            .frame(height: 14)
                    }
                }
                if let trailing {
                    Text(trailing)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .padding(.horizontal, NSpacing.sm)
                        .padding(.vertical, NSpacing.xxs)
                }
            }
        }
    }

}
