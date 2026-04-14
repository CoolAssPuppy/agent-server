import SwiftUI
import NerdsUI
import AppKit

/// Two-pane main window shell: left sidebar (240px) + main pane (flex).
/// Drawers overlay: the detail drawer slides in from x=240, the settings
/// drawer slides down from the titlebar. Only one drawer is open at a time,
/// governed by `DrawerRouter`.
struct MainWindow: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject private var router = DrawerRouter.shared
    @EnvironmentObject var themeManager: ThemeManager

    private var isDark: Bool { themeManager.currentTheme.palette.isDark }

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                Sidebar(
                    monitor: monitor,
                    router: router,
                    onOpenFolder: openAgentsFolder,
                    onNewAgent: newAgent
                )
                Divider().opacity(0.3)
                MainPane(monitor: monitor, router: router)
            }

            mainPaneDimOverlay

            detailDrawerLayer

            settingsDrawerLayer

            titlebarGear
        }
        .frame(minWidth: 1080, minHeight: 640)
        .nTheme(themeManager.themeConfig)
        .background(themeManager.themeConfig.tokens.background)
        .environment(\.colorScheme, isDark ? .dark : .light)
    }

    // MARK: - Overlays

    @ViewBuilder
    private var mainPaneDimOverlay: some View {
        if router.isDetailOpen {
            HStack(spacing: 0) {
                Color.clear.frame(width: Sidebar.width)
                Color(red: 17/255, green: 24/255, blue: 39/255)
                    .opacity(0.22)
                    .onTapGesture(perform: router.close)
            }
            .allowsHitTesting(true)
            .transition(.opacity)
        }
    }

    @ViewBuilder
    private var detailDrawerLayer: some View {
        if case .detail(let agentId) = router.open {
            HStack(spacing: 0) {
                Color.clear.frame(width: Sidebar.width)
                AgentDetailDrawer(
                    monitor: monitor,
                    router: router,
                    agentId: agentId
                )
                .transition(.move(edge: .leading))
                Spacer()
            }
            .animation(.easeOut(duration: AgentDetailDrawer.slideDuration), value: router.openAgentId)
        }
    }

    @ViewBuilder
    private var settingsDrawerLayer: some View {
        if router.isSettingsOpen {
            VStack(spacing: 0) {
                SettingsDrawer(monitor: monitor, router: router)
                    .transition(.move(edge: .top))
                Color.black.opacity(0.22)
                    .onTapGesture(perform: router.close)
            }
            .animation(.easeOut(duration: SettingsDrawer.slideDuration), value: router.isSettingsOpen)
        }
    }

    private var titlebarGear: some View {
        HStack {
            Spacer()
            // Hide the gear entirely while the settings drawer is open — its
            // close affordance lives inside the drawer itself (the ✕ circle
            // in the drawer's upper-right corner). Showing both is confusing.
            if !router.isSettingsOpen {
                Button {
                    withAnimation(.easeOut(duration: SettingsDrawer.slideDuration)) {
                        router.openSettings()
                    }
                } label: {
                    Image(systemName: "gearshape")
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(themeManager.themeConfig.tokens.mutedForeground)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, NSpacing.sm)
                .padding(.top, NSpacing.xs)
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: router.isSettingsOpen)
    }

    // MARK: - Actions

    private func openAgentsFolder() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let url = home.appendingPathComponent(".agent-server/agents")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    private func newAgent() {
        openAgentsFolder()
    }
}
