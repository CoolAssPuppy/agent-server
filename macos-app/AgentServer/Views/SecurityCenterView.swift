import SwiftUI
import NerdsUI

private enum SecurityPanelStyle {
    static let listWidth: CGFloat = 360
    static let transitionDuration = 0.22
}

struct SecurityCenterView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    @State private var navigation: SecurityPanelNavigationState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(monitor: StatusMonitor, router: DrawerRouter, agentId: String?) {
        self.monitor = monitor
        self.router = router
        _navigation = State(initialValue: SecurityPanelNavigationState(selectedAgentId: agentId))
    }

    var body: some View {
        TopDrawerSurface(
            title: "Security check",
            closeLabel: "Close security check",
            onClose: close,
            onEscape: stepBackOrClose,
            titleIcon: "checkmark.shield",
            titleStatus: titleStatus
        ) {
            securityPanels
        }
    }

    @ViewBuilder
    private var securityPanels: some View {
        if monitor.securityScanState.phase == .scanning
            || monitor.securityScanState.phase == .failed,
           navigation.selectedAgentId == nil {
            SecurityScanProgressView(
                state: monitor.securityScanState,
                failure: monitor.securityScanFailure,
                retry: retry
            )
        } else {
            HStack(spacing: 0) {
                dashboardPanel
                if let agentId = navigation.selectedAgentId {
                    Divider().opacity(0.35)
                    agentPanel(agentId: agentId)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .animation(
                reduceMotion ? nil : .easeInOut(duration: SecurityPanelStyle.transitionDuration),
                value: navigation.selectedAgentId
            )
        }
    }

    @ViewBuilder
    private var dashboardPanel: some View {
        if navigation.selectedAgentId == nil {
            dashboard
                .frame(maxWidth: .infinity)
        } else {
            dashboard
                .frame(width: SecurityPanelStyle.listWidth)
        }
    }

    private var dashboard: some View {
        SecurityDashboardView(
            dashboard: monitor.securityDashboard,
            showsHeading: false,
            isCompact: navigation.selectedAgentId != nil,
            selectedAgentId: navigation.selectedAgentId,
            actions: dashboardActions,
            openAgent: { navigation.selectAgent($0) }
        )
    }

    private func agentPanel(agentId: String) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: NSpacing.sm) {
                Button {
                    _ = navigation.stepBack()
                } label: {
                    Label("All agents", systemImage: "chevron.left")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to all agents")
                Spacer()
            }
            .padding(.horizontal, NSpacing.xl)
            .padding(.vertical, NSpacing.md)
            Divider().opacity(0.3)
            AgentSecurityAnalyzerView(
                agentName: monitor.agents.first(where: { $0.id == agentId })?.name ?? agentId,
                actions: agentActions(agentId: agentId),
                showsHeading: false
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func stepBackOrClose() {
        if !navigation.stepBack() {
            close()
        }
    }

    private func close() {
        router.closeSecurity()
    }

    private var titleStatus: TopDrawerTitleStatus {
        switch monitor.securityScanState.phase {
        case .scanning: .working
        case .failed: .error
        case .idle, .complete: .normal
        }
    }

    private func retry() {
        Task { _ = await monitor.scanAllSecurity() }
    }

    private var dashboardActions: SecurityDashboardActions {
        SecurityDashboardActions(
            scanAll: { await monitor.scanAllSecurity() },
            exportReport: { .success(monitor.redactedSecurityReport()) }
        )
    }

    private func agentActions(agentId: String) -> AgentSecurityActions {
        AgentSecurityActions(
            scan: { await monitor.analyzeSecurity(agentId: agentId) },
            reviewFix: { await monitor.reviewSecurityFix(agentId: agentId, findingId: $0) },
            applyFix: { await monitor.applySecurityFix(agentId: agentId, findingId: $0) },
            ignore: { findingId, _ in
                await monitor.acknowledgeSecurityFinding(agentId: agentId, findingId: findingId)
            },
            markReviewed: { await monitor.markSecurityReviewed(agentId: agentId) }
        )
    }
}
