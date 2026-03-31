import SwiftUI
import NerdsUI

struct SettingsView: View {
    @ObservedObject var monitor: StatusMonitor
    @State private var showSettings = false

    @Environment(\.nTheme) private var theme

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

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings")
                    .font(NTypography.titleLarge)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(NTypography.titleLarge)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.top, NSpacing.xl)
            .padding(.bottom, NSpacing.md)

            Divider()

            SettingsTabView(monitor: monitor)
                .padding(.horizontal, NSpacing.sm)
        }
        .frame(width: 580, height: 680)
    }
}
