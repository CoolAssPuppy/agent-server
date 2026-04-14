import SwiftUI
import NerdsUI

struct AgentsListView: View {
    @ObservedObject var monitor: StatusMonitor
    var onOpenSettings: (() -> Void)?
    @State private var selectedAgentId: String?
    @State private var showNewAgentSheet = false
    @State private var deepLinkToRuns = false

    @Environment(\.nTheme) private var theme

    private var agentsDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/agents")
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .sheet(isPresented: $showNewAgentSheet) {
            NewAgentSheet(isPresented: $showNewAgentSheet) { newId in
                selectedAgentId = newId
                monitor.poll()
            }
        }
        .onChange(of: monitor.deepLinkAgentId) { _, newId in
            guard let newId else { return }
            deepLinkToRuns = true
            selectedAgentId = newId
            monitor.deepLinkAgentId = nil
        }
    }

    private var badgeViewModel: AgentsListBadgeViewModel {
        AgentsListBadgeViewModel(decisions: monitor.pendingDecisions)
    }

    @ViewBuilder
    private var sidebar: some View {
        List(monitor.agents, selection: $selectedAgentId) { agent in
            AgentRow(
                agent: agent,
                isRunning: isRunning(agent),
                pendingDecisionsCount: badgeViewModel.badge(forAgentSlug: agent.id)
            )
                .tag(agent.id)
        }
        .listStyle(.sidebar)
        .overlay {
            if !monitor.isServerReachable {
                ContentUnavailableView(
                    "Server offline",
                    systemImage: "bolt.horizontal.circle",
                    description: Text("Start the agent server to see your agents.")
                )
            } else if monitor.agents.isEmpty {
                ContentUnavailableView(
                    "No agents",
                    systemImage: "tray",
                    description: Text("Create an agent to get started.")
                )
            }
        }
        .safeAreaInset(edge: .top) {
            VStack(spacing: 0) {
                HStack {
                    Text("Agents")
                        .font(NTypography.displaySmall)
                        .fontWeight(.bold)
                    Spacer()
                    if let onOpenSettings {
                        Button {
                            onOpenSettings()
                        } label: {
                            Image(systemName: "gearshape")
                                .font(.system(size: NIconSize.sm))
                                .foregroundStyle(theme.tokens.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .help("Settings")
                    }
                }
                .padding(.horizontal, NSpacing.lg)
                .padding(.top, NSpacing.md)
                .padding(.bottom, NSpacing.xxs)

                if monitor.staleRunCount > 0 {
                    StaleRunsBanner(count: monitor.staleRunCount) {
                        monitor.cleanupStaleRuns()
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button {
                    NSWorkspace.shared.open(agentsDir)
                } label: {
                    HStack(spacing: NSpacing.xxs) {
                        Image(systemName: "folder")
                        Text("Open folder")
                    }
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.borderless)
                .help("Open ~/.agent-server/agents in Finder")

                Spacer()

                Button {
                    showNewAgentSheet = true
                } label: {
                    HStack(spacing: NSpacing.xxs) {
                        Image(systemName: "plus")
                        Text("New agent")
                    }
                    .font(NTypography.caption)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.sm)
            .background(.bar)
        }
        .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 400)
    }

    @ViewBuilder
    private var detail: some View {
        if let selectedAgentId {
            AgentDetailView(
                agentId: selectedAgentId,
                monitor: monitor,
                initialTab: deepLinkToRuns ? .runs : .definition
            )
            .id("\(selectedAgentId)-\(deepLinkToRuns)")
            .onAppear { deepLinkToRuns = false }
        } else {
            ContentUnavailableView(
                "Select an agent",
                systemImage: "doc.text",
                description: Text("Choose an agent from the list to view or edit its definition.")
            )
        }
    }

    private func isRunning(_ agent: Agent) -> Bool {
        monitor.activeRuns.contains { $0.agentId == agent.id }
    }
}

// MARK: - Agent row

private struct AgentRow: View {
    let agent: Agent
    let isRunning: Bool
    var pendingDecisionsCount: Int? = nil

    @Environment(\.nTheme) private var theme

    private var kindColor: Color {
        let c = agent.kind.color
        return Color(red: c.r, green: c.g, blue: c.b)
    }

    var body: some View {
        HStack(spacing: NSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .fill((isRunning ? Color.green : kindColor).opacity(0.15))
                    .frame(width: 36, height: 36)

                if isRunning {
                    GlowingPulsingBall(color: .green)
                } else {
                    Image(systemName: agent.kind.icon)
                        .font(.system(size: NIconSize.sm, weight: .medium))
                        .foregroundStyle(kindColor)
                }
            }

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                HStack(spacing: NSpacing.xs) {
                    Text(agent.name)
                        .font(NTypography.headlineSmall)
                        .foregroundStyle(theme.tokens.foreground)

                    if let count = pendingDecisionsCount {
                        HStack(spacing: NSpacing.xxxs) {
                            Circle()
                                .fill(theme.tokens.destructive)
                                .frame(width: 6, height: 6)
                            Text("\(count)")
                                .font(NTypography.badge)
                                .foregroundStyle(theme.tokens.destructive)
                        }
                        .padding(.horizontal, NSpacing.xs)
                        .padding(.vertical, NSpacing.xxxs)
                        .background(theme.tokens.destructive.opacity(0.12))
                        .clipShape(Capsule())
                        .accessibilityLabel("\(count) pending decision\(count == 1 ? "" : "s")")
                    }

                    if !agent.enabled {
                        Text("Disabled")
                            .font(NTypography.badge)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .padding(.horizontal, NSpacing.xs)
                            .padding(.vertical, NSpacing.xxxs)
                            .background(theme.tokens.muted)
                            .clipShape(Capsule())
                    }
                }

                if let description = agent.description {
                    Text(description)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                }

                if agent.enabled {
                    HStack(spacing: NSpacing.xxs) {
                        Text(agent.kind.label)
                            .font(NTypography.caption)
                            .foregroundStyle(kindColor)

                        if agent.isScheduled {
                            Image(systemName: "clock")
                                .font(.system(size: 9))
                                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.6))
                                .help(agent.scheduleDisplay)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, NSpacing.xxs)
    }
}

private struct GlowingPulsingBall: View {
    let color: Color
    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 14, height: 14)
            .shadow(color: color.opacity(isPulsing ? 0.9 : 0.4), radius: isPulsing ? 8 : 3)
            .shadow(color: color.opacity(isPulsing ? 0.6 : 0.2), radius: isPulsing ? 14 : 5)
            .scaleEffect(isPulsing ? 1.08 : 0.92)
            .opacity(isPulsing ? 1.0 : 0.75)
            .animation(
                .easeInOut(duration: 1.1).repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear { isPulsing = true }
    }
}

// MARK: - Stale runs banner

private struct StaleRunsBanner: View {
    let count: Int
    let onCleanup: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
                .font(.system(size: NIconSize.xs))

            Text("\(count) stale run\(count == 1 ? "" : "s") detected")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)

            Spacer()

            Button("Clean up") {
                onCleanup()
            }
            .font(NTypography.caption)
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.xs)
        .background(.yellow.opacity(0.1))
    }
}