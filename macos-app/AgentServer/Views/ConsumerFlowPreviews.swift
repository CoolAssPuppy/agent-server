import SwiftUI

#if DEBUG
#Preview("Create an agent") {
    GuidedAgentCreationView(
        actions: GuidedAgentCreationActions(
            prepare: { _, _ in .success(.proposal(ConsumerFlowDemoFixtures.proposal)) },
            save: { _, shouldTest in
                .success(SavedAgentPresentation(
                    agentId: "friday-summary",
                    safeTestRunId: shouldTest ? "safe-test-run" : nil
                ))
            }
        ),
        onCancel: {},
        onCreated: { _ in }
    )
    .nTheme(ThemeManager.shared.themeConfig)
}

#Preview("Proposal review") {
    ScrollView {
        AgentProposalView(proposal: ConsumerFlowDemoFixtures.proposal)
            .padding()
    }
    .frame(width: 720, height: 700)
    .nTheme(ThemeManager.shared.themeConfig)
}

#Preview("Agent debugger") {
    AgentDebuggerView(
        failedRunId: "failed-demo-run",
        actions: AgentDebuggerActions(
            diagnose: { .success(ConsumerFlowDemoFixtures.diagnosis) },
            applyFix: { _ in .success(()) },
            retry: { .success("retry-demo-run") },
            stopRun: { _ in }
        ),
        openAgentSettings: {},
        openRun: { _ in }
    )
    .frame(width: 780, height: 700)
    .nTheme(ThemeManager.shared.themeConfig)
}

#Preview("Security dashboard") {
    SecurityDashboardView(
        dashboard: ConsumerFlowDemoFixtures.dashboard,
        actions: SecurityDashboardActions(
            scanAll: { .success(ConsumerFlowDemoFixtures.dashboard) },
            exportReport: { .success("Agent Server security report\nAll credential values are redacted.") }
        ),
        openAgent: { _ in }
    )
    .frame(width: 900, height: 700)
    .nTheme(ThemeManager.shared.themeConfig)
}

#Preview("Agent security check") {
    AgentSecurityAnalyzerView(
        agentName: "Friday GitHub summary",
        actions: AgentSecurityActions(
            scan: { .success(ConsumerFlowDemoFixtures.securityScan) },
            reviewFix: { _ in .success(GuidancePatchPreview(
                resultContentHash: "sha256:preview",
                changes: [.init(field: "tools", summary: "Turn off command access")],
                advancedChanges: .object(["tools": .array([.string("Read")])]),
                risk: "low",
                requiresConfirmation: false,
                canApply: true
            )) },
            applyFix: { _ in .success(ConsumerFlowDemoFixtures.securityScan) },
            ignore: { _, _ in .success(ConsumerFlowDemoFixtures.securityScan) },
            markReviewed: { .success(ConsumerFlowDemoFixtures.securityScan) }
        )
    )
    .frame(width: 780, height: 700)
    .nTheme(ThemeManager.shared.themeConfig)
}
#endif
