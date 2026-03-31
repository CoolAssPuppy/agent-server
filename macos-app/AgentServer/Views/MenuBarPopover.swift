import SwiftUI
import NerdsUI

struct MenuBarPopover: View {
    @ObservedObject var monitor: StatusMonitor
    @EnvironmentObject var themeManager: ThemeManager
    var onOpenSettings: ((String?) -> Void)?
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

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            agentList
            Divider().opacity(0.3)
            bottomBar
        }
        .frame(width: 360, height: 440)
        .background(theme.tokens.background)
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
                            onOpenSettings?(agent.id)
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
                onOpenSettings?(nil)
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
                        .frame(width: show ? 10 : 0, height: 10)
                        .opacity(show ? 1 : 0)
                        .overlay(
                            Circle()
                                .stroke(Color.primary.opacity(0.25), lineWidth: isActive ? 1.5 : 0)
                                .frame(width: 14, height: 14)
                                .opacity(isActive ? 1 : 0)
                        )
                }
                .buttonStyle(.plain)
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
