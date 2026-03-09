import SwiftUI

struct AgentsListView: View {
    @ObservedObject var monitor: StatusMonitor

    private var agentsDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/agents")
    }

    var body: some View {
        VStack(spacing: 0) {
            Group {
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
                        description: Text("Add agent files to ~/.agent-server/agents/")
                    )
                } else {
                    List(monitor.agents) { agent in
                        AgentRow(agent: agent, isRunning: isRunning(agent), onRun: {
                            monitor.triggerRun(agentId: agent.id)
                        })
                    }
                }
            }
            .frame(maxHeight: .infinity)

            Divider()

            HStack {
                Button {
                    NSWorkspace.shared.open(agentsDir)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                        Text("~/.agent-server/agents")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help("Open agents directory in Finder")

                Spacer()

                Text("Add YAML or Markdown files to create agents")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func isRunning(_ agent: Agent) -> Bool {
        monitor.activeRuns.contains { $0.agentId == agent.id }
    }
}

private struct AgentRow: View {
    let agent: Agent
    let isRunning: Bool
    let onRun: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(agent.name)
                        .font(.headline)

                    if !agent.enabled {
                        Text("Disabled")
                            .font(.caption2)
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

                Text(agent.scheduleDisplay)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            if isRunning {
                ProgressView()
                    .controlSize(.small)
            } else {
                Button("Run") {
                    onRun()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(!agent.enabled)
            }
        }
        .padding(.vertical, 4)
    }
}
