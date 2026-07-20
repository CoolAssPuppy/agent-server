import SwiftUI
import AgentServerDesignSystem

/// Menu bar popover (mock 1EL-0). Layout: header → optional Needs-you →
/// Running / Up next / Recent / All agents lists → bottom bar.
struct MenuBarPopover: View {
    @ObservedObject var monitor: StatusMonitor
    @EnvironmentObject var themeManager: ThemeManager

    /// Fires when the user clicks the "Agent Server" title or the dashboard
    /// icon. Opens the main window to home (no drawer).
    var onOpenHome: (() -> Void)?
    /// Fires when the user clicks the gear icon. Opens the main window with
    /// the settings drawer down (3NT-1).
    var onOpenSettings: (() -> Void)?
    /// Fires when the user clicks an agent row. Opens the main window with
    /// the detail drawer for that agent (3I6-1).
    var onOpenAgent: ((String) -> Void)?
    var onQuit: (() -> Void)?

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var decisionsViewModel: MenuBarDecisionsViewModel {
        MenuBarDecisionsViewModel(decisions: monitor.pendingDecisions)
    }

    private var runningAgents: [Agent] {
        let runningIds = Set(monitor.activeRuns.map(\.agentId))
        return monitor.agents
            .filter { runningIds.contains($0.id) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var availableAgents: [Agent] {
        let runningIds = Set(monitor.activeRuns.map(\.agentId))
        let availableIds = AgentCatalogPresentation.availableAgentIds(
            agentIds: monitor.agents.map(\.id),
            runningAgentIds: runningIds
        )
        return monitor.agents
            .filter { availableIds.contains($0.id) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 0) {
                    if decisionsViewModel.isVisible {
                        needsYouSection
                    }
                    if !runningAgents.isEmpty {
                        SectionDivider()
                        runningSection
                    }
                    if !availableAgents.isEmpty {
                        SectionDivider()
                        allAgentsSection
                    }
                    if !monitor.isServerReachable && monitor.agents.isEmpty {
                        SectionDivider()
                        offlineEmpty
                    } else if monitor.agents.isEmpty {
                        SectionDivider()
                        emptyState
                    }
                }
            }
            bottomBar
        }
        .frame(width: 360, height: 520)
        .textSelection(.enabled)
        .nTheme(themeManager.themeConfig)
        .background(themeManager.themeConfig.tokens.background)
        .environment(\.colorScheme, themeManager.currentTheme.palette.isDark ? .dark : .light)
    }

    // MARK: - Header

    private var header: some View {
        Button {
            onOpenHome?()
        } label: {
            HStack(spacing: NSpacing.sm) {
                Text("Agent Server")
                    .font(NTypography.bodyMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.tokens.foreground)

                Spacer()

                if !monitor.activeRuns.isEmpty {
                    HStack(spacing: NSpacing.xxs) {
                        if reduceMotion {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 8, height: 8)
                        } else {
                            PulsingDot(color: .green)
                                .frame(width: 8, height: 8)
                        }
                        Text("\(monitor.activeRuns.count) running")
                            .font(NTypography.captionSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                    .help("\(monitor.activeRuns.count) agent run(s) in progress")
                }

                Circle()
                    .fill(monitor.isServerReachable ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                    .help(monitor.isServerReachable ? "Server reachable" : "Server offline")
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Open Agent Server dashboard")
        .padding(.horizontal, 18)
        .padding(.top, NSpacing.lg)
        .padding(.bottom, 10)
    }

    // MARK: - Needs you

    private var needsYouSection: some View {
        VStack(spacing: NSpacing.sm) {
            sectionLabel(title: "Needs you", trailing: "\(decisionsViewModel.badgeCount)")
                .padding(.horizontal, NSpacing.lg)
                .padding(.top, NSpacing.md)

            ForEach(decisionsViewModel.cards) { card in
                NeedsYouCard(
                    card: card,
                    onAction: { intent in handle(intent: intent, for: card) }
                )
                .padding(.horizontal, NSpacing.md)
            }
        }
        .padding(.bottom, NSpacing.md)
    }

    private func handle(intent: DecisionActionIntent, for card: DecisionCard) {
        switch intent.kind {
        case .openInPanel:
            if let urlString = card.openInPanelURL, let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }
        default:
            monitor.resolveDecision(id: card.decisionId, body: intent.resolveBody)
        }
    }

    // MARK: - Running

    private var runningSection: some View {
        VStack(spacing: NSpacing.xxs) {
            sectionLabel(title: "Running", trailing: "\(runningAgents.count)")
                .padding(.horizontal, NSpacing.lg)
                .padding(.top, NSpacing.sm)
                .padding(.bottom, NSpacing.xxs)

            ForEach(runningAgents) { agent in
                agentButton(agent: agent, variant: .running, trailingText: nil)
            }
        }
        .padding(.bottom, NSpacing.xxs)
    }

    // MARK: - All agents

    private var allAgentsSection: some View {
        VStack(spacing: NSpacing.xxs) {
            sectionLabel(title: "All agents", trailing: "\(availableAgents.count)")
                .padding(.horizontal, NSpacing.lg)
                .padding(.top, NSpacing.sm)
                .padding(.bottom, NSpacing.xxs)

            ForEach(availableAgents) { agent in
                agentButton(agent: agent, variant: .scheduled, trailingText: agent.scheduleDisplay)
            }
        }
        .padding(.bottom, NSpacing.sm)
    }

    // MARK: - Empty / offline

    private var offlineEmpty: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "bolt.horizontal.circle")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Server offline")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, NSpacing.huge)
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("No agents")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, NSpacing.huge)
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        HStack {
            Button {
                onOpenSettings?()
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Settings")
            .accessibilityLabel("Settings")

            Button {
                onOpenHome?()
            } label: {
                Image(systemName: "rectangle.grid.2x2")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Open dashboard")
            .accessibilityLabel("Open dashboard")

            Spacer()

            ThemeDotStrip()

            Spacer()

            Button {
                onQuit?()
            } label: {
                Image(systemName: "power")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Quit")
            .accessibilityLabel("Quit Agent Server")
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.xs)
        .overlay(alignment: .top) {
            Divider().opacity(0.4)
        }
    }

    // MARK: - Helpers

    private func sectionLabel(title: String, trailing: String) -> some View {
        HStack {
            Text(title)
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(trailing)
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
        }
    }

    private func agentButton(
        agent: Agent,
        variant: PopoverRowVariant,
        trailingText: String?
    ) -> some View {
        Button {
            onOpenAgent?(agent.id)
        } label: {
            PopoverAgentRow(agent: agent, variant: variant, trailingText: trailingText)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            MenuBarPopoverPresentation.agentAccessibilityLabel(
                name: agent.name,
                isRunning: variant == .running,
                schedule: trailingText
            )
        )
        .accessibilityHint(MenuBarPopoverPresentation.agentAccessibilityHint)
        .accessibilityIdentifier("menuBar.agent.\(agent.id)")
    }

}

// MARK: - Theme picker

private struct ThemeDotStrip: View {
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presentation = ThemePickerPresentation()

    var body: some View {
        HStack(spacing: presentation.isExpanded ? NSpacing.xxs : 0) {
            ForEach(AgentServerThemeId.allCases) { appTheme in
                themeButton(appTheme)
            }
        }
        .padding(.horizontal, presentation.isExpanded ? NSpacing.xs : NSpacing.xxxs)
        .padding(.vertical, NSpacing.xxs)
        .animation(animation, value: presentation.isExpanded)
        .onHover { isHovering in
            withAnimation(animation) {
                presentation.setHovering(isHovering)
            }
        }
        .help(MenuBarPopoverPresentation.appearanceTitle)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(MenuBarPopoverPresentation.appearanceTitle)
        .accessibilityValue(themeManager.currentTheme.displayName)
        .accessibilityHint(MenuBarPopoverPresentation.appearanceHint)
        .accessibilityIdentifier("menuBar.appearance")
    }

    private func themeButton(_ appTheme: AgentServerThemeId) -> some View {
        let isActive = themeManager.currentTheme == appTheme
        let isVisible = presentation.isExpanded || isActive

        return Button {
            withAnimation(animation) {
                if presentation.isExpanded {
                    themeManager.currentTheme = appTheme
                    presentation.didSelectTheme()
                } else {
                    presentation.toggleExpanded()
                }
            }
        } label: {
            Circle()
                .fill(appTheme.dotColor)
                .frame(width: 10, height: 10)
                .scaleEffect(isVisible ? 1 : 0.01)
                .opacity(isVisible ? 1 : 0)
                .overlay {
                    Circle()
                        .stroke(Color.primary.opacity(0.25), lineWidth: isActive ? 1.5 : 0)
                        .frame(width: 14, height: 14)
                        .opacity(isActive ? 1 : 0)
                }
        }
        .buttonStyle(.plain)
        .frame(width: isVisible ? 10 : 0)
        .clipped()
        .help(appTheme.displayName)
        .accessibilityLabel(appTheme.displayName)
        .accessibilityValue(isActive ? "Selected" : "")
        .accessibilityHidden(!isVisible)
        .accessibilityIdentifier("menuBar.appearance.\(appTheme.rawValue)")
    }

    private var animation: Animation? {
        ThemePickerPresentation.motion(reduceMotion: reduceMotion) == .none
            ? nil
            : NAnimation.bouncy
    }
}

// MARK: - Section divider

private struct SectionDivider: View {
    @Environment(\.nTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.tokens.border.opacity(0.6))
            .frame(height: 1)
            .padding(.horizontal, NSpacing.lg)
    }
}

// MARK: - Agent row variants

private enum PopoverRowVariant {
    case running
    case scheduled
}

private struct PopoverAgentRow: View {
    let agent: Agent
    let variant: PopoverRowVariant
    let trailingText: String?

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.md) {
            iconWell
                .frame(width: 26, height: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(agent.name)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)

                if let description = agent.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(2)
                }

                // Timing under the description (same treatment as the
                // main window sidebar). Smaller, more muted.
                if let trailingText, !trailingText.isEmpty {
                    Text(trailingText)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private var iconWell: some View {
        switch variant {
        case .running:
            ZStack {
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .fill(Color.green.opacity(0.15))
                if reduceMotion {
                    Image(systemName: agent.kind.icon)
                        .font(.system(size: NIconSize.xs, weight: .semibold))
                        .foregroundStyle(Color.green)
                } else {
                    PulsingIcon(systemName: agent.kind.icon, size: NIconSize.xs, color: Color.green)
                }
            }
        case .scheduled:
            ZStack {
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .fill(theme.tokens.muted)
                Image(systemName: agent.kind.icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
    }

}

// MARK: - Needs you card

private struct NeedsYouCard: View {
    let card: DecisionCard
    let onAction: (DecisionActionIntent) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack(spacing: NSpacing.xs) {
                Text("Decision")
                    .font(NTypography.badge)
                    .tracking(0.4)
                    .foregroundStyle(theme.tokens.primaryForeground)
                    .padding(.horizontal, NSpacing.sm)
                    .padding(.vertical, 2)
                    .background(theme.tokens.primary)
                    .clipShape(Capsule())
                Text("\(card.agentName) · \(card.relativeTimestamp)")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
                Spacer()
            }

            Text(card.title)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            metadataLine

            agentActionsRow
                .padding(.top, 2)
        }
        .padding(NSpacing.md)
        .background(theme.tokens.primary.opacity(0.12))
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.primary.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    @ViewBuilder
    private var metadataLine: some View {
        let parts = buildMetadataParts()
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
        }
    }

    private func buildMetadataParts() -> [String] {
        var parts: [String] = []
        if let rec = recommendedLabel() { parts.append("Recommends \(rec)") }
        if let c = card.confidence { parts.append("\(Int(c * 100))% confidence") }
        if card.sourcesCount > 0 {
            parts.append("\(card.sourcesCount) source\(card.sourcesCount == 1 ? "" : "s")")
        }
        return parts
    }

    private func recommendedLabel() -> String? {
        card.agentActions.first(where: { $0.isRecommended })?.label
    }

    private var agentActionsRow: some View {
        HStack(spacing: NSpacing.xs) {
            ForEach(card.agentActions, id: \.self) { action in
                Button {
                    onAction(action)
                } label: {
                    Text(action.label)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(action.isRecommended ? theme.tokens.primaryForeground : theme.tokens.foreground)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                        .background(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .fill(action.isRecommended ? theme.tokens.primary : theme.tokens.muted)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(action.accessibilityLabel)
            }
        }
    }
}
