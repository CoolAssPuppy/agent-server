import SwiftUI
import NerdsUI
import AppKit

/// Slide-in drawer that overlays the main pane from the left edge of the main
/// area (x=240). Width 780, full remaining height. Consumer-focused agent
/// page: schedule in plain English, the last run's outcome, and a capability
/// summary. Editing (including permissions) lives behind the gear button;
/// full run history hides behind "View history".
struct AgentDetailDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0
    @State private var showHistory = false
    @State private var showSettings = false
    @State private var runToOpen: String?

    static let width: CGFloat = 780
    static let slideDuration: Double = 0.22
    static let dismissThreshold: CGFloat = 80

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    /// Width of the settings pane when it's open beside the detail.
    private static let settingsPaneWidth: CGFloat = 460

    var body: some View {
        HStack(spacing: 0) {
            // Detail pane. Fills the space left of the settings pane; when
            // settings opens, this shrinks and the agent "draws left".
            ZStack(alignment: .trailing) {
                VStack(spacing: 0) {
                    header
                    Divider().opacity(0.3)
                    content
                }
                if !showSettings { grabBar }
            }
            .frame(maxWidth: .infinity)

            // Settings pane. Slides in from the right, sitting beside the
            // detail rather than covering it — one continuous surface.
            if showSettings {
                Divider().opacity(0.3)
                AgentSettingsSheet(
                    monitor: monitor,
                    agentId: agentId,
                    isPresented: $showSettings,
                    onDeleted: { router.close() }
                )
                .id(agentId)
                .frame(width: Self.settingsPaneWidth)
                .transition(.move(edge: .trailing))
            }
        }
        .frame(maxWidth: showSettings ? .infinity : Self.width)
        .frame(maxHeight: .infinity)
        .background(theme.tokens.background)
        .overlay(leadingBorder, alignment: .leading)
        // Rasterize the whole drawer as one layer BEFORE the shadow. Without
        // this, SwiftUI draws the shadow per opaque subview inside the
        // drawer, producing visible inner drop-shadows that shouldn't be there.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 20, x: -8, y: 0)
        .offset(x: dragOffset)
        .onChange(of: agentId) { previousAgentId, selectedAgentId in
            showHistory = false
            runToOpen = nil
            if AgentSettingsSelectionPolicy.shouldDismissSettings(
                previousAgentId: previousAgentId,
                selectedAgentId: selectedAgentId
            ) {
                showSettings = false
            }
        }
        .onExitCommand(perform: dismissDeepestDetail)
    }

    private func openSettings() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.slideDuration)) { showSettings = true }
    }

    private func closeSettings() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.slideDuration)) { showSettings = false }
    }

    private func dismissDeepestDetail() {
        switch AgentDetailDismissalPolicy.action(
            isSettingsPresented: showSettings,
            isHistoryPresented: showHistory
        ) {
        case .closeSettings:
            closeSettings()
        case .closeHistory:
            showHistory = false
            runToOpen = nil
        case .closeDetail:
            router.close()
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

            Button {
                router.openCreation(sourceAgentId: agentId)
            } label: {
                Image(systemName: "plus.square.on.square")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Create something similar")
            .accessibilityLabel("Create something similar to this agent")
            .accessibilityIdentifier(ConsumerFlowAccessibility.creationSimilar)

            Button {
                router.openSecurity(agentId: agentId)
            } label: {
                Image(systemName: "checkmark.shield")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Run a security check")
            .accessibilityLabel("Run a security check for this agent")
            .accessibilityIdentifier(ConsumerFlowAccessibility.securityNavigation)

            Button {
                openSettings()
            } label: {
                Image(systemName: "gearshape")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Edit agent & permissions")
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if showHistory {
            historyView
        } else if let agent {
            summaryView(for: agent)
        } else {
            Text("Agent not found.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func summaryView(for agent: Agent) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            AgentRunControl(
                agent: agent,
                monitor: monitor,
                onOpenSettings: { showSettings = true },
                onReviewSecurity: { router.openSecurity(agentId: agent.id) },
                onOpenRun: { runId in
                    runToOpen = runId
                    showHistory = true
                }
            )
            .id(agent.id)
            scheduleRow(for: agent)
            safetyReadinessRow(for: agent)
            lastRunCard(for: agent)
                .frame(maxHeight: .infinity)
            capabilitiesStrip(for: agent)
        }
        .padding(NSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Schedule

    private func scheduleRow(for agent: Agent) -> some View {
        HStack(spacing: NSpacing.sm) {
            Image(systemName: "clock")
                .font(.system(size: 12))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(agent.scheduleDisplay)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.foreground)
            if let schedule = agent.schedule,
               let next = CronNextFire.next(schedule, after: Date()) {
                Text("· next \(next.formatted(.relative(presentation: .numeric)))")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            Spacer()
        }
    }

    private func safetyReadinessRow(for agent: Agent) -> some View {
        let presentation = safetyReadiness(for: agent)
        return AgentSafetyReadinessRow(presentation: presentation) {
            switch presentation.action {
            case .openSettings: openSettings()
            case .reviewSecurity: router.openSecurity(agentId: agent.id)
            }
        }
    }

    private func safetyReadiness(for agent: Agent) -> AgentSafetyReadinessPresentation {
        let missingConnections = (agent.capabilities ?? []).count { capability in
            guard capability.enabled, capability.kind == "mcp" else { return false }
            return !capability.envReady || capability.status == "needs-auth" || capability.status == "failed"
        }
        let result = monitor.securityDashboard?.agents.first(where: { $0.id == agent.id })?.result
            ?? .pending
        return AgentSafetyReadinessPresentation(
            securityResult: result,
            missingConnectionCount: missingConnections
        )
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
                Button {
                    showHistory = true
                } label: {
                    Text("View history")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
                .help("All past runs and details")
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
        if lower.contains("kimi") { return "Kimi K2" }
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

    // MARK: - History

}

extension AgentDetailDrawer {
    private var historyView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: NSpacing.xs) {
                Button {
                    showHistory = false
                } label: {
                    HStack(spacing: NSpacing.xxs) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .semibold))
                        Text("Back")
                            .font(NTypography.caption)
                    }
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Text("Run history")
                    .font(NTypography.labelMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Spacer()
            }
            .padding(.horizontal, NSpacing.xl)
            .padding(.vertical, NSpacing.sm)
            Divider().opacity(0.3)
            AgentRunsView(
                agentId: agentId,
                monitor: monitor,
                initiallySelectedRunId: runToOpen
            )
        }
    }
}
