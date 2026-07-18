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
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            mainPaneDimOverlay

            creationDrawerLayer

            detailDrawerLayer

            settingsDrawerLayer

            connectionsDrawerLayer

            securityDrawerLayer

            debuggerDrawerLayer
        }
        .frame(minWidth: 1080, minHeight: 640)
        .nTheme(themeManager.themeConfig)
        .background(themeManager.themeConfig.tokens.background)
        .environment(\.colorScheme, isDark ? .dark : .light)
        .onAppear { commitPendingRouteIfAny() }
        .onChange(of: router.pending) { _, _ in commitPendingRouteIfAny() }
    }

    /// Consumes `DrawerRouter.shared.pending` (set by AppDelegate when the
    /// popover triggered the window open) and animates the drawer into view.
    /// Runs after a single runloop hop so SwiftUI has laid out the closed
    /// state before the route flip — otherwise the transition is skipped.
    private func commitPendingRouteIfAny() {
        guard let pending = router.pending else { return }
        let duration: Double
        switch pending {
        case .creation: duration = SettingsDrawer.slideDuration
        case .detail: duration = AgentDetailDrawer.slideDuration
        case .settings: duration = SettingsDrawer.slideDuration
        case .connections, .security, .debugger: duration = SettingsDrawer.slideDuration
        }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: duration)) {
                router.routeTo(pending)
            }
            router.pending = nil
        }
    }

    // MARK: - Overlays

    private var creationDrawerLayer: some View {
        ZStack(alignment: .top) {
            if router.isCreationOpen {
                GuidedAgentCreationView(
                    actions: GuidedAgentCreationActions(
                        prepare: monitor.prepareGuidedAgent,
                        save: monitor.saveGuidedAgent
                    ),
                    onCancel: router.close,
                    onCreated: openCreatedAgent
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: SettingsDrawer.slideDuration), value: router.isCreationOpen)
    }

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

    /// Detail drawer: slides out from the right edge of the sidebar (as if
    /// tucked behind it). The slot to the right of the sidebar is clipped,
    /// so when the drawer animates in with .move(edge: .leading) it emerges
    /// from the sidebar's right border rather than crossing over it.
    private var detailDrawerLayer: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: Sidebar.width)
            ZStack(alignment: .leading) {
                if case .detail(let agentId) = router.open {
                    AgentDetailDrawer(
                        monitor: monitor,
                        router: router,
                        agentId: agentId
                    )
                    .transition(.move(edge: .leading))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .clipped()
        }
        .animation(
            .easeOut(duration: AgentDetailDrawer.slideDuration),
            value: router.openAgentId
        )
    }

    /// Settings drawer: slides down from the top of the window. Full window
    /// width, flush with the top edge (the drawer visually covers the
    /// transparent titlebar area while open — that's the "drawer sliding
    /// over the titlebar" feel). Rounded bottom corners only.
    private var settingsDrawerLayer: some View {
        ZStack(alignment: .top) {
            Group {
                if router.isSettingsOpen {
                    Color.black.opacity(0.22)
                        .onTapGesture(perform: router.close)
                        .transition(.opacity)
                }
            }
            Group {
                if router.isSettingsOpen {
                    SettingsDrawer(monitor: monitor, router: router)
                        .transition(
                            .move(edge: .top).combined(with: .opacity)
                        )
                }
            }
        }
        .animation(
            .easeOut(duration: SettingsDrawer.slideDuration),
            value: router.isSettingsOpen
        )
    }

    /// Connections drawer: slides down from the top like Settings.
    private var connectionsDrawerLayer: some View {
        ZStack(alignment: .top) {
            Group {
                if router.isConnectionsOpen {
                    Color.black.opacity(0.22)
                        .onTapGesture(perform: router.close)
                        .transition(.opacity)
                }
            }
            Group {
                if router.isConnectionsOpen {
                    ConnectionsView(monitor: monitor, router: router)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .animation(.easeOut(duration: SettingsDrawer.slideDuration), value: router.isConnectionsOpen)
    }

    private var securityDrawerLayer: some View {
        ZStack(alignment: .top) {
            if router.isSecurityOpen {
                SecurityCenterView(
                    monitor: monitor,
                    router: router,
                    agentId: router.securityAgentId
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: SettingsDrawer.slideDuration), value: router.isSecurityOpen)
    }

    private var debuggerDrawerLayer: some View {
        ZStack(alignment: .top) {
            if let runId = router.debugRunId {
                AgentDebuggerEntryShell(
                    runId: runId,
                    actions: AgentDebuggerActions(
                        diagnose: { await monitor.diagnoseRun(id: runId) },
                        applyFix: { _ in await monitor.applyDebuggerFix(runId: runId) },
                        retry: { await monitor.retryRun(id: runId) },
                        stopRun: monitor.cancelRun
                    ),
                    close: { closeDebugger(runId) },
                    openAgentSettings: { openSettingsForRun(runId) },
                    openRun: openRun
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: SettingsDrawer.slideDuration), value: router.isDebuggerOpen)
    }

    // MARK: - Actions

    private func openAgentsFolder() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let url = home.appendingPathComponent(".agent-server/agents")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    private func newAgent() {
        router.openCreation()
    }

    private func openCreatedAgent(_ saved: SavedAgentPresentation) {
        monitor.poll()
        router.openDetail(agentId: saved.agentId)
    }

    private func openSettingsForRun(_ runId: String) {
        guard let run = monitor.recentRuns.first(where: { $0.runId == runId }) else { return }
        router.openDetail(agentId: run.agentId)
    }

    private func openRun(_ runId: String) {
        guard let run = monitor.recentRuns.first(where: { $0.runId == runId }) else { return }
        router.openDetail(agentId: run.agentId)
    }

    private func closeDebugger(_ runId: String) {
        guard let run = monitor.recentRuns.first(where: { $0.runId == runId }) else {
            router.close()
            return
        }
        router.openDetail(agentId: run.agentId)
    }
}
