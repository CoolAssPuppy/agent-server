import SwiftUI

struct SettingsView: View {
    @ObservedObject var monitor: StatusMonitor
    @State private var showSettings = false

    var body: some View {
        AgentsListView(monitor: monitor, onOpenSettings: { showSettings = true })
            .sheet(isPresented: $showSettings) {
                SettingsSheet(monitor: monitor, isPresented: $showSettings)
            }
            .frame(minWidth: 980, minHeight: 550)
    }
}

private struct SettingsSheet: View {
    @ObservedObject var monitor: StatusMonitor
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings")
                    .font(.title2)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 12)

            Divider()

            SettingsTabView(monitor: monitor)
                .padding(.horizontal, 8)
        }
        .frame(width: 580, height: 680)
    }
}
