import Foundation

public enum ConsumerFlowDemoFixtures {
    public static let proposal = AgentProposalPresentation(
        name: "Friday GitHub summary",
        explanation: "Reviews your GitHub activity each Friday and sends a short summary to Slack.",
        schedule: "Every Friday at 5:00 p.m.",
        permissions: ["Read GitHub activity", "Use the internet", "Send a Slack message"],
        fileAccess: [],
        connections: [
            ConnectionPresentation(name: "GitHub", state: .connected),
            ConnectionPresentation(name: "Slack", state: .needsSetup),
        ],
        instructions: "Review this week's GitHub activity. Write a short summary with completed work, open work, and anything that needs attention. If activity is unavailable, explain what is missing. Never include credentials or private repository contents in a message.",
        risk: .needsReview,
        riskReason: "This agent sends information to Slack and needs internet access.",
        protectedTestAvailability: .available
    )

    public static let diagnosis = DiagnosticPresentation(
        title: "This agent could not send its summary.",
        explanation: "Slack has not been connected on this Mac.",
        evidence: [
            "The agent prepared the summary successfully",
            "The run stopped when it tried to send the message",
            "Slack currently shows Needs setup",
        ],
        recommendedFix: ConfigurationFixPresentation(
            title: "Connect Slack",
            impact: "This lets the agent send messages only through the Slack connection you approve.",
            risk: .needsReview,
            changes: ["Connect the selected Slack workspace"],
            technicalDiff: "+ notification.channel: slack"
        ),
        preventionTip: "Connect required apps before turning on a schedule.",
        technicalDetails: "Connection unavailable: slack (credential redacted)"
    )

    public static let securityScan = SecurityScanPresentation(
        findings: [
            SecurityFindingPresentation(
                id: "external-message",
                severity: .needsReview,
                title: "This agent sends information to Slack",
                whyItMatters: "A summary can include information from your GitHub activity.",
                potentialImpact: "Information could be posted to the wrong channel if the destination is incorrect.",
                trigger: "External messaging is enabled",
                recommendation: "Confirm the Slack destination before the first run.",
                functionalityImpact: "The agent will ask for review before sending its first message.",
                canFix: true
            ),
            SecurityFindingPresentation(
                id: "network-and-input",
                severity: .high,
                title: "External content can influence this agent",
                whyItMatters: "Text from issues or pull requests could contain misleading instructions.",
                potentialImpact: "The agent could include unintended content in its summary.",
                trigger: "Untrusted text plus network access",
                recommendation: "Treat GitHub text as information, never as instructions.",
                functionalityImpact: "The summary still includes GitHub activity, with safer handling.",
                canFix: true
            ),
        ],
        reviewedAt: nil,
        isStale: true
    )

    public static let dashboard = SecurityDashboardPresentation(agents: [
        SecurityAgentPresentation(
            id: "friday-summary",
            name: "Friday GitHub summary",
            risk: .high,
            findingCount: 2,
            isStale: true,
            approval: .awaitingApproval
        ),
        SecurityAgentPresentation(
            id: "research-index",
            name: "Research index",
            risk: .low,
            findingCount: 0,
            isStale: false,
            approval: .notRequired
        ),
        SecurityAgentPresentation(
            id: "inbox-helper",
            name: "Inbox helper",
            risk: .needsReview,
            findingCount: 1,
            isStale: false,
            approval: .awaitingApproval
        ),
        SecurityAgentPresentation(
            id: "expense-filer",
            name: "Expense filer",
            risk: .high,
            findingCount: 1,
            isStale: false,
            approval: .approved(Date(timeIntervalSince1970: 1_770_000_000))
        ),
    ])
}
