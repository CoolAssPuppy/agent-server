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

                HStack(spacing: 4) {
                    Text(agent.kind.label)
                        .font(.caption)
                        .foregroundStyle(kindColor)

                    if agent.isScheduled {
                        Text("--")
                            .font(.caption)
                            .foregroundStyle(.quaternary)
                        Text(agent.scheduleDisplay)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer()

            if isRunning {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Running")
                        .font(.caption)
                        .foregroundStyle(kindColor)
                }
            } else {
                Button {
                    onRun()
                } label: {
                    Image(systemName: "play.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(agent.enabled ? kindColor : Color.gray)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!agent.enabled)
            }
        }
        .padding(.vertical, 4)
    }
}
