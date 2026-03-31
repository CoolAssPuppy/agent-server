import SwiftUI
import NerdsUI

enum AgentDetailTab: String, CaseIterable {
    case definition = "Definition"
    case runs = "Runs"
}

struct AgentDetailView: View {
    let agentId: String
    @ObservedObject var monitor: StatusMonitor
    @State private var selectedTab: AgentDetailTab

    @Environment(\.nTheme) private var theme

    init(agentId: String, monitor: StatusMonitor, initialTab: AgentDetailTab = .definition) {
        self.agentId = agentId
        self.monitor = monitor
        _selectedTab = State(initialValue: initialTab)
    }

    private var agent: Agent? {
        monitor.agents.first { $0.id == agentId }
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider()
            tabContent
        }
    }

    private var headerBar: some View {
        HStack(alignment: .center, spacing: NSpacing.md) {
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(agent?.name ?? agentId)
                    .font(NTypography.titleLarge)
                    .fontWeight(.semibold)
                    .lineLimit(1)

                if let description = agent?.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }

            Spacer()

            Picker("", selection: $selectedTab) {
                ForEach(AgentDetailTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
        .background(.bar)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .definition:
            AgentEditorView(agentId: agentId, monitor: monitor)
        case .runs:
            AgentRunsView(agentId: agentId, monitor: monitor)
        }
    }
}
