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
        }
        .frame(minWidth: 1080, minHeight: 640)
        .nTheme(themeManager.themeConfig)
        .background(themeManager.themeConfig.tokens.background)
        .environment(\.colorScheme, isDark ? .dark : .light)
        .onAppear { commitPendingRouteIfAny() }
        .onChange(of: router.pending) { _ in commitPendingRouteIfAny() }
    }

    /// Consumes `DrawerRouter.shared.pending` (set by AppDelegate when the
    /// popover triggered the window open) and animates the drawer into view.
    /// Runs after a single runloop hop so SwiftUI has laid out the closed
    /// state before the route flip — otherwise the transition is skipped.
    private func commitPendingRouteIfAny() {
        guard let pending = router.pending else { return }
        let duration: Double
        switch pending {
        case .detail: duration = AgentDetailDrawer.slideDuration
        case .settings: duration = SettingsDrawer.slideDuration
        }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: duration)) {
                router.routeTo(pending)
            }
            router.pending = nil
        }
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

    /// Detail drawer: left-edge slide. Animation modifier is OUTSIDE the
    /// conditional so SwiftUI observes the state flip on the container and
    /// drives the child's transition.
    private var detailDrawerLayer: some View {
        ZStack(alignment: .topLeading) {
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
            }
        }
        .animation(
            .easeOut(duration: AgentDetailDrawer.slideDuration),
            value: router.openAgentId
        )
    }

    /// Settings drawer: top-edge slide over the main pane. The window's
    /// `fullSizeContentView` makes the content area include the titlebar, so
    /// the drawer starts 48pt down to clear the traffic lights before its
    /// rounded top edge appears.
    private var settingsDrawerLayer: some View {
        ZStack(alignment: .top) {
            if router.isSettingsOpen {
                Color.black.opacity(0.22)
                    .onTapGesture(perform: router.close)
                    .transition(.opacity)

                SettingsDrawer(monitor: monitor, router: router)
                    .padding(.horizontal, NSpacing.lg)
                    .padding(.top, 48)
                    .transition(
                        .move(edge: .top).combined(with: .opacity)
                    )
            }
        }
        .animation(
            .easeOut(duration: SettingsDrawer.slideDuration),
            value: router.isSettingsOpen
        )
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
