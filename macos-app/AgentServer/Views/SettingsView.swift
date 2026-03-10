import SwiftUI

struct SettingsView: View {
    @ObservedObject var monitor: StatusMonitor
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            AgentsListView(monitor: monitor)
                .tabItem {
                    Label("Agents", systemImage: "person.2")
                }
                .tag(0)

            SettingsTabView(monitor: monitor)
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(1)
        }
        .frame(minWidth: 800, minHeight: 500)
    }
}
