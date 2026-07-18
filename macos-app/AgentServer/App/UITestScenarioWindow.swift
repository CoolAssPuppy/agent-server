import AppKit
import SwiftUI
import NerdsUI

#if DEBUG
enum UITestScenario: String {
    case creation
    case debugger
    case security
    case highRiskCreation = "high-risk-creation"

    static var current: UITestScenario? {
        ProcessInfo.processInfo.environment["AGENT_SERVER_UI_TEST_SCENARIO"]
            .flatMap(UITestScenario.init(rawValue:))
    }
}

@MainActor
enum UITestScenarioWindow {
    static func makeWindow(for scenario: UITestScenario) -> NSWindow {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        let root = UITestScenarioRoot(scenario: scenario)
            .nTheme(ThemeManager.shared.themeConfig)
            .frame(minWidth: 1_080, maxWidth: .infinity, minHeight: 720, maxHeight: .infinity)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_280, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Server"
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: root)
        window.minSize = NSSize(width: 1_080, height: 720)
        window.setContentSize(NSSize(width: 1_280, height: 900))
        let screen = NSScreen.screens.first(where: { $0.frame.contains(CGPoint.zero) }) ?? NSScreen.main
        if let visibleFrame = screen?.visibleFrame {
            let x = visibleFrame.midX - window.frame.width / 2
            let y = visibleFrame.midY - window.frame.height / 2
            window.setFrameOrigin(NSPoint(x: x, y: y))
        }
        window.makeKeyAndOrderFront(nil)
        return window
    }
}

private struct UITestScenarioRoot: View {
    let scenario: UITestScenario

    var body: some View {
        switch scenario {
        case .creation:
            creationView(proposal: Self.readOnlyProposal)
        case .highRiskCreation:
            creationView(proposal: Self.highRiskProposal)
        case .debugger:
            debuggerView
        case .security:
            SecurityScenarioView()
        }
    }

    private func creationView(proposal: AgentProposalPresentation) -> some View {
        GuidedAgentCreationView(
            actions: GuidedAgentCreationActions(
                prepare: { _, _ in .success(.proposal(proposal)) },
                save: { _, shouldTest in
                    .success(SavedAgentPresentation(
                        agentId: "friday-github-summary",
                        safeTestRunId: shouldTest ? "safe-test-run" : nil
                    ))
                }
            ),
            onCancel: {},
            onCreated: { _ in },
            setUpConnections: { _ in }
        )
    }

    private var debuggerView: some View {
        AgentDebuggerView(
            failedRunId: "failed-run",
            actions: AgentDebuggerActions(
                diagnose: { .success(Self.diagnosis) },
                applyFix: { _ in .success(()) },
                retry: { .success("retry-run") },
                stopRun: { _ in }
            ),
            openAgentSettings: {},
            openRun: { _ in }
        )
    }

    private static let readOnlyProposal = AgentProposalPresentation(
        reviewId: "review-read-only",
        name: "Friday GitHub summary",
        explanation: "Review your GitHub activity and prepare a short Slack summary.",
        schedule: "Every Friday at 5:00 PM",
        permissions: ["Read GitHub activity", "Send messages to Slack"],
        fileAccess: [FileAccessPresentation(path: "~/Documents/Reports", canEdit: false)],
        connections: [ConnectionPresentation(
            name: "Slack",
            state: .needsSetup,
            isRequired: true,
            reason: "Slack is needed to send the summary."
        )],
        instructions: "Summarize completed work, open pull requests, and notable changes. Do not expose secrets.",
        risk: .needsReview,
        riskReason: "It can send a summary to a connected service, but file access is read-only."
    )

    private static let highRiskProposal = AgentProposalPresentation(
        reviewId: "review-high-risk",
        name: "Command reporter",
        explanation: "Run a local command and send its output to an external service.",
        schedule: "Only when you run it manually",
        permissions: ["Run commands", "Use the internet", "Send messages"],
        fileAccess: [],
        connections: [],
        instructions: "Run the approved command. Show a preview before sending any output.",
        risk: .high,
        riskReason: "Command execution and internet access together can expose information from this Mac."
    )

    private static let diagnosis = DiagnosticPresentation(
        title: "This agent could not save its report.",
        explanation: "It tried to create a report in a folder where editing is turned off.",
        evidence: [
            "The agent attempted to write to ~/Documents/Reports.",
            "File editing is currently turned off.",
            "The run stopped before creating the report."
        ],
        recommendedFix: ConfigurationFixPresentation(
            title: "Allow edits in Documents/Reports",
            impact: "This allows changes only in the selected Reports folder.",
            risk: .low,
            changes: ["Allow edits in Documents/Reports"],
            technicalDiff: "+ permissions: [Read, Write(~/Documents/Reports)]"
        ),
        preventionTip: "Run a safe test before turning on its schedule.",
        technicalDetails: "Write access denied for ~/Documents/Reports"
    )
}

@MainActor
private final class SecurityScenarioStore: ObservableObject {
    @Published private(set) var scan = SecurityScenarioStore.initialScan

    func apply(findingId: String) -> SecurityScanPresentation {
        scan = SecurityScanPresentation(
            findings: scan.findings.filter { $0.id != findingId },
            reviewedAt: nil,
            isStale: false
        )
        return scan
    }

    private static let initialScan = SecurityScanPresentation(
        findings: [
            SecurityFindingPresentation(
                id: "literal-secret",
                severity: .critical,
                title: "A secret appears in the agent file",
                whyItMatters: "Anyone who can read the file may be able to use this credential.",
                potentialImpact: "The credential could be copied and used outside Agent Server.",
                trigger: "A credential-shaped value was found and redacted.",
                recommendation: "Move it to a secure connection setting.",
                functionalityImpact: "The agent will keep using the same service after it is connected securely.",
                canFix: true
            ),
            SecurityFindingPresentation(
                id: "broad-home",
                severity: .high,
                title: "This agent can edit your entire home folder",
                whyItMatters: "This is broader than the agent needs.",
                potentialImpact: "A mistake could change personal files outside the reports folder.",
                trigger: "Writable path: ~/",
                recommendation: "Limit editing to Documents/Reports.",
                functionalityImpact: "The agent can still create and update reports in that folder.",
                canFix: true
            )
        ],
        reviewedAt: nil,
        isStale: false
    )
}

private struct SecurityScenarioView: View {
    @StateObject private var store = SecurityScenarioStore()

    var body: some View {
        AgentSecurityAnalyzerView(
            agentName: "Weekly report",
            actions: AgentSecurityActions(
                scan: { .success(store.scan) },
                applyFix: { .success(store.apply(findingId: $0)) },
                ignore: { findingId, _ in .success(store.apply(findingId: findingId)) },
                markReviewed: { .success(store.scan) }
            )
        )
    }
}
#endif
