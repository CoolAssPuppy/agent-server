import SwiftUI
import NerdsUI

struct MenuBarPopover: View {
    @ObservedObject var monitor: StatusMonitor
    @EnvironmentObject var themeManager: ThemeManager
    /// Fires when the user clicks the gear icon. Opens the main window with
    /// the settings drawer down (3NT-1).
    var onOpenSettings: (() -> Void)?
    /// Fires when the user clicks an agent row. Opens the main window with
    /// the detail drawer for that agent (3I6-1).
    var onOpenAgent: ((String) -> Void)?
    var onQuit: (() -> Void)?

    @Environment(\.nTheme) private var theme

    private var sortedAgents: [Agent] {
        let running = Set(monitor.activeRuns.map(\.agentId))
        return monitor.agents.sorted { a, b in
            let aRunning = running.contains(a.id)
            let bRunning = running.contains(b.id)
            if aRunning != bRunning { return aRunning }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    private var decisionsViewModel: MenuBarDecisionsViewModel {
        MenuBarDecisionsViewModel(decisions: monitor.pendingDecisions)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            if decisionsViewModel.isVisible {
                needsYouSection
                Divider().opacity(0.3)
            }
            agentList
            Divider().opacity(0.3)
            bottomBar
        }
        .frame(width: 360, height: 440)
        .nTheme(themeManager.themeConfig)
        .background(themeManager.themeConfig.tokens.background)
        .environment(\.colorScheme, themeManager.currentTheme.palette.isDark ? .dark : .light)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Agent Server")
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)

            Spacer()

            if monitor.isServerReachable {
                Circle()
                    .fill(.green)
                    .frame(width: 6, height: 6)
            } else {
                Circle()
                    .fill(.red)
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
    }

    // MARK: - Needs you

    private var needsYouSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack {
                Text("Needs you")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer()
                Text("\(decisionsViewModel.badgeCount)")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .padding(.horizontal, NSpacing.lg)
            .padding(.top, NSpacing.sm)

            ForEach(decisionsViewModel.cards) { card in
                NeedsYouCard(
                    card: card,
                    onAction: { intent in
                        handle(intent: intent, for: card)
                    }
                )
                .padding(.horizontal, NSpacing.lg)
                .padding(.bottom, NSpacing.xs)
            }
        }
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

    // MARK: - Agent list

    private var agentList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if !monitor.isServerReachable {
                    serverOfflineView
                } else if monitor.agents.isEmpty {
                    emptyView
                } else {
                    ForEach(sortedAgents) { agent in
                        PopoverAgentRow(
                            agent: agent,
                            isRunning: monitor.activeRuns.contains { $0.agentId == agent.id }
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            onOpenAgent?(agent.id)
                        }

                        if agent.id != sortedAgents.last?.id {
                            Divider()
                                .padding(.horizontal, NSpacing.lg)
                                .opacity(0.2)
                        }
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var serverOfflineView: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "bolt.horizontal.circle")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Server offline")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, NSpacing.huge)
    }

    private var emptyView: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("No agents")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, NSpacing.huge)
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        HStack {
            Button {
                onOpenSettings?()
            } label: {
                Image(systemName: "gearshape")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground.opacity(0.4))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Settings")

            Spacer()

            ThemeDotStrip()

            Spacer()

            Button {
                onQuit?()
            } label: {
                Image(systemName: "power")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground.opacity(0.4))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Quit")
        }
        .padding(.horizontal, NSpacing.sm)
        .padding(.vertical, NSpacing.xs)
    }
}

// MARK: - Agent row in popover

private struct PopoverAgentRow: View {
    let agent: Agent
    let isRunning: Bool

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: agent.kind.icon)
                .font(.system(size: NIconSize.sm))
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(width: NIconSize.md)

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(agent.name)
                    .font(NTypography.bodyMedium)
                    .fontWeight(.medium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)

                if let description = agent.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                }
            }

            Spacer()

            if isRunning {
                PulsingDot(color: .green)
            }
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
    }
}

// MARK: - Needs you card

private struct NeedsYouCard: View {
    let card: DecisionCard
    let onAction: (DecisionActionIntent) -> Void

    @Environment(\.nTheme) private var theme
    @State private var showDeferMenu = false

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(alignment: .top, spacing: NSpacing.xs) {
                Text("Decision")
                    .font(NTypography.badge)
                    .foregroundStyle(theme.tokens.primaryForeground)
                    .padding(.horizontal, NSpacing.xs)
                    .padding(.vertical, NSpacing.xxxs)
                    .background(theme.tokens.primary)
                    .clipShape(Capsule())
                Text(card.agentName)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.foreground)
                Text("·")
                    .foregroundStyle(theme.tokens.mutedForeground)
                Text(card.relativeTimestamp)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer()
            }

            Text(card.title)
                .font(NTypography.bodyMedium)
                .fontWeight(.semibold)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            metadataLine

            agentActionsRow

            systemRow
        }
        .padding(NSpacing.md)
        .background(theme.tokens.primary.opacity(0.12))
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.primary.opacity(0.4), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    @ViewBuilder
    private var metadataLine: some View {
        let parts = buildMetadataParts()
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
        }
    }

    private func buildMetadataParts() -> [String] {
        var parts: [String] = []
        if let rec = recommendedLabel() {
            parts.append("Recommends \(rec)")
        }
        if let c = card.confidence {
            parts.append("\(Int(c * 100))% confidence")
        }
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
                        .font(NTypography.bodySmall)
                        .fontWeight(.semibold)
                        .foregroundStyle(action.isRecommended ? theme.tokens.primaryForeground : theme.tokens.foreground)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, NSpacing.xs)
                        .background(action.isRecommended ? theme.tokens.primary : theme.tokens.muted)
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(action.accessibilityLabel)
            }
        }
    }

    private var systemRow: some View {
        HStack(spacing: NSpacing.xs) {
            Menu {
                ForEach(card.systemActions.filter {
                    if case .defer1Hour = $0.kind { return true }
                    if case .deferTomorrow = $0.kind { return true }
                    return false
                }, id: \.self) { action in
                    Button(action.label) { onAction(action) }
                        .accessibilityLabel(action.accessibilityLabel)
                }
            } label: {
                HStack(spacing: NSpacing.xxxs) {
                    Text("Defer")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9))
                }
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("Defer decision")

            Spacer()

            if let openAction = card.systemActions.first(where: { $0.kind == .openInPanel }) {
                Button {
                    onAction(openAction)
                } label: {
                    Text(openAction.label)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(openAction.accessibilityLabel)
            }
        }
    }
}

// MARK: - Theme dot strip

struct ThemeDotStrip: View {
    @EnvironmentObject var themeManager: ThemeManager
    @State private var isExpanded = false

    var body: some View {
        HStack(spacing: isExpanded ? NSpacing.xxs : 0) {
            ForEach(AgentServerThemeId.allCases) { appTheme in
                let isActive = themeManager.currentTheme == appTheme
                let show = isExpanded || isActive

                Button {
                    withAnimation(NAnimation.bouncy) {
                        themeManager.currentTheme = appTheme
                        isExpanded = false
                    }
                } label: {
                    Circle()
                        .fill(appTheme.dotColor)
                        .frame(width: 10, height: 10)
                        .scaleEffect(show ? 1 : 0.01)
                        .opacity(show ? 1 : 0)
                        .overlay(
                            Circle()
                                .stroke(Color.primary.opacity(0.25), lineWidth: isActive ? 1.5 : 0)
                                .frame(width: 14, height: 14)
                                .opacity(isActive ? 1 : 0)
                        )
                }
                .buttonStyle(.plain)
                .frame(width: show ? 10 : 0)
                .clipped()
                .help(appTheme.displayName)
            }
        }
        .padding(.horizontal, isExpanded ? NSpacing.xs : NSpacing.xxxs)
        .padding(.vertical, NSpacing.xxs)
        .animation(NAnimation.bouncy, value: isExpanded)
        .onHover { hovering in
            withAnimation(NAnimation.bouncy) {
                isExpanded = hovering
            }
        }
    }
}
