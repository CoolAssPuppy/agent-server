import SwiftUI
import NerdsUI

/// Left-hand agent list for the main window. Width 240. Rows show the three-
/// state dot, agent name, a 3-line clamped description, and a pending-decision
/// pill when applicable.
struct Sidebar: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    var onOpenFolder: () -> Void
    var onNewAgent: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var showNewAgentSheet = false

    static let width: CGFloat = 240

    private var rows: [SidebarRow] {
        let runningIds = Set(monitor.activeRuns.map(\.agentId))
        let lastRuns = monitor.lastRunByAgent
        let agents = monitor.agents.map { agent in
            SidebarAgent(
                id: agent.id,
                slug: agent.id,
                name: agent.name,
                description: agent.description,
                scheduleLabel: agent.schedule.map { CronEnglishFormatter.describe($0) },
                kind: SidebarKindBridge.from(agent.kind),
                lastRunFailed: lastRuns[agent.id]?.status == .failed,
                isEnabled: agent.enabled
            )
        }
        return SidebarSort.sortedRows(
            agents: agents,
            runningAgentIds: runningIds,
            pendingDecisions: monitor.pendingDecisions
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            if monitor.staleRunCount > 0 {
                staleRunsBanner
                Divider().opacity(0.3)
            }
            list
            Divider().opacity(0.3)
            footer
        }
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(theme.tokens.background)
        .sheet(isPresented: $showNewAgentSheet) {
            CreateAgentSheet(monitor: monitor, isPresented: $showNewAgentSheet) { agentId in
                monitor.poll()
                router.openDetail(agentId: agentId)
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Agents")
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Text("\(rows.count)")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(theme.tokens.muted)
                .clipShape(Capsule())
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.top, NSpacing.xxl)
        .padding(.bottom, NSpacing.md)
    }

    private var list: some View {
        ScrollView {
            if rows.isEmpty {
                emptyListState
            } else {
                LazyVStack(spacing: NSpacing.xxxs) {
                    ForEach(rows) { row in
                        SidebarRowView(
                            row: row,
                            isSelected: router.openAgentId == row.id,
                            onSelect: { router.openDetail(agentId: row.id) }
                        )
                        .animation(.easeOut(duration: 0.28), value: row.state)
                    }
                }
                .padding(.horizontal, NSpacing.xs)
                .padding(.vertical, NSpacing.xs)
                .animation(.easeOut(duration: 0.28), value: rows.map(\.id))
            }
        }
        .frame(maxHeight: .infinity)
    }

    /// Yellow banner that appears when the daemon restarts mid-run,
    /// leaving runs in a 'stale' state. One tap clears them via
    /// StatusMonitor.cleanupStaleRuns (RPC into the local server).
    private var staleRunsBanner: some View {
        HStack(spacing: NSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
                .font(.system(size: 11))
            Text("\(monitor.staleRunCount) stale run\(monitor.staleRunCount == 1 ? "" : "s")")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Button("Clean up") { monitor.cleanupStaleRuns() }
                .buttonStyle(.borderless)
                .font(NTypography.caption)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.xs)
        .background(Color.yellow.opacity(0.1))
    }

    /// Empty-list state when the server reports zero agents. Not shown
    /// when the server is unreachable — StatusMonitor holds `agents = []`
    /// in that case too, but we distinguish via `isServerReachable`.
    private var emptyListState: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: monitor.isServerReachable ? "tray" : "bolt.horizontal.circle")
                .font(.system(size: 28))
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.5))
            Text(monitor.isServerReachable ? "No agents yet" : "Server offline")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(monitor.isServerReachable
                 ? "Click New agent below to create your first one."
                 : "Start the agent server daemon to see your agents.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.xl)
    }

    private var footer: some View {
        HStack(spacing: NSpacing.sm) {
            Button(action: onOpenFolder) {
                Label("Open folder", systemImage: "folder")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .buttonStyle(.plain)

            Spacer()

            // `onNewAgent` callback is kept on the view so callers can
            // intercept (e.g., open the agents folder), but the default
            // behavior now presents the NewAgentSheet template flow from
            // the legacy UI. Tap → sheet, user fills in details, onCreate
            // → we re-poll monitor so the new agent appears in the list.
            Button {
                showNewAgentSheet = true
            } label: {
                Label("New agent", systemImage: "plus")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.primary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
    }
}

// MARK: - Row

private struct SidebarRowView: View {
    let row: SidebarRow
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            statusDot
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                HStack(spacing: NSpacing.xs) {
                    Text(row.name)
                        .font(NTypography.bodyMedium)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.tokens.foreground)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    if row.pendingDecisionCount > 0 {
                        Text("\(row.pendingDecisionCount)")
                            .font(NTypography.badge)
                            .foregroundStyle(theme.tokens.primaryForeground)
                            .padding(.horizontal, NSpacing.xs)
                            .padding(.vertical, 1)
                            .background(theme.tokens.primary)
                            .clipShape(Capsule())
                    }

                    if !row.isEnabled {
                        Text("Disabled")
                            .font(NTypography.badge)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .padding(.horizontal, NSpacing.xs)
                            .padding(.vertical, 1)
                            .background(theme.tokens.muted)
                            .clipShape(Capsule())
                    }

                    Spacer(minLength: 0)
                }

                if let description = row.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let schedule = row.scheduleLabel, !schedule.isEmpty {
                    Text(schedule)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground.opacity(0.8))
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, NSpacing.sm)
        .padding(.vertical, NSpacing.sm)
        .background(rowBackground)
        .overlay(rowBorder)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }

    /// Type-specific SF Symbol instead of a neutral dot. Color encodes state:
    /// green = currently running, red = last run failed, primary-gold = pending
    /// decision, muted = idle. When running, the icon lightly pulses + glows
    /// so a live agent reads as obviously different from a static one.
    @ViewBuilder
    private var statusDot: some View {
        if row.state == .running {
            PulsingIcon(systemName: row.kind.iconName, size: 12, color: Color.green)
                .frame(width: 14, height: 14)
        } else {
            Image(systemName: row.kind.iconName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(iconColor)
                .frame(width: 14, height: 14)
        }
    }

    private var iconColor: Color {
        switch row.state {
        case .idle: return theme.tokens.mutedForeground.opacity(0.7)
        case .needsYou: return theme.tokens.primary
        case .running: return Color.green
        case .failed: return Color.red
        }
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            theme.tokens.primary.opacity(0.12)
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private var rowBorder: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.primary.opacity(0.35), lineWidth: 1)
        }
    }
}

// MARK: - Kind bridge

/// Bridges the app-target's `AgentKind` enum (with NSColor + view logic)
/// to the framework-free `SidebarRow.Kind` used by the view model.
enum SidebarKindBridge {
    static func from(_ kind: AgentKind) -> SidebarRow.Kind {
        switch kind {
        case .scheduled: return .scheduled
        case .interactive: return .interactive
        case .watcher: return .watcher
        case .chained: return .chained
        case .onDemand: return .onDemand
        }
    }
}
