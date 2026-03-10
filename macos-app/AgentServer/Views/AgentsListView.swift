import SwiftUI

struct AgentsListView: View {
    @ObservedObject var monitor: StatusMonitor
    @State private var selectedAgentId: String?
    @State private var showNewAgentSheet = false

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
    }

    @ViewBuilder
    private var sidebar: some View {
        List(monitor.agents, selection: $selectedAgentId) { agent in
            AgentRow(agent: agent, isRunning: isRunning(agent))
                .tag(agent.id)
        }
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
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button {
                    NSWorkspace.shared.open(agentsDir)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                        Text("Open folder")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help("Open ~/.agent-server/agents in Finder")

                Spacer()

                Button {
                    showNewAgentSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                        Text("New agent")
                    }
                    .font(.caption)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
        }
        .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 400)
    }

    @ViewBuilder
    private var detail: some View {
        if let selectedAgentId {
            AgentEditorView(agentId: selectedAgentId, monitor: monitor)
                .id(selectedAgentId)
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

private struct AgentRow: View {
    let agent: Agent
    let isRunning: Bool

    private var kindColor: Color {
        let c = agent.kind.color
        return Color(red: c.r, green: c.g, blue: c.b)
    }

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(kindColor.opacity(0.15))
                    .frame(width: 36, height: 36)

                Image(systemName: agent.kind.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(kindColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(agent.name)
                        .font(.headline)

                    if !agent.enabled {
                        Text("Disabled")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.quaternary)
                            .clipShape(Capsule())
                    }
                }

                if let description = agent.description {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 5) {
                    Text(agent.kind.label)
                        .font(.caption)
                        .foregroundStyle(kindColor)

                    if agent.isScheduled {
                        Image(systemName: "clock")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                            .help(agent.scheduleDisplay)
                    }
                }
            }

            Spacer()

            if isRunning {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}
