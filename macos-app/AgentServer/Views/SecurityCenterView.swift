import SwiftUI
import NerdsUI

struct SecurityCenterView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String?

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            closeBar
            Divider().opacity(0.3)
            if let agentId {
                AgentSecurityAnalyzerView(
                    agentName: monitor.agents.first(where: { $0.id == agentId })?.name ?? agentId,
                    actions: agentActions(agentId: agentId)
                )
            } else {
                SecurityDashboardView(
                    actions: dashboardActions,
                    openAgent: { router.openSecurity(agentId: $0) }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
    }

    private var closeBar: some View {
        HStack {
            Button(action: close) {
                Label("Close security check", systemImage: "xmark")
                    .labelStyle(.iconOnly)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .keyboardShortcut("w", modifiers: .command)
            .accessibilityLabel("Close security check")
            Spacer()
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
    }

    private func close() {
        if let agentId {
            router.openDetail(agentId: agentId)
        } else {
            router.close()
        }
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
            applyFix: { _ in
                .failure(ConsumerFlowFailure(
                    title: "Review this change in agent settings",
                    message: "This fix cannot be applied from the security check yet.",
                    recovery: "Open agent settings and make the recommended change.",
                    technicalDetails: "No validated configuration patch was supplied.",
                    didSave: false,
                    canRetry: false
                ))
            },
            ignore: { findingId, _ in
                await monitor.acknowledgeSecurityFinding(agentId: agentId, findingId: findingId)
            },
            markReviewed: { await monitor.markSecurityReviewed(agentId: agentId) }
        )
    }
}
