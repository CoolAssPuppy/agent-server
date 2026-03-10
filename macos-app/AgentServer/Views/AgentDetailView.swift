import SwiftUI

enum AgentDetailTab: String, CaseIterable {
    case definition = "Definition"
    case runs = "Runs"
}

struct AgentDetailView: View {
    let agentId: String
    @ObservedObject var monitor: StatusMonitor
    @State private var selectedTab: AgentDetailTab = .definition

    var body: some View {
        VStack(spacing: 0) {
            tabPicker
            Divider()
            tabContent
        }
    }

    private var tabPicker: some View {
        HStack {
            Picker("", selection: $selectedTab) {
                ForEach(AgentDetailTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
