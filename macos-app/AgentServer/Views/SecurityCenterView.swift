import SwiftUI

struct SecurityCenterView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String?

    var body: some View {
        TopDrawerSurface(
            title: "Security check",
            closeLabel: "Close security check",
            onClose: close
        ) {
            if let agentId {
                AgentSecurityAnalyzerView(
                    agentName: monitor.agents.first(where: { $0.id == agentId })?.name ?? agentId,
                    actions: agentActions(agentId: agentId),
                    showsHeading: false
                )
            } else {
                SecurityDashboardView(
                    showsHeading: false,
                    actions: dashboardActions,
                    openAgent: { router.openSecurity(agentId: $0) }
                )
            }
        }
    }

    private func close() {
        router.closeSecurity()
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
