import AppKit
import SwiftUI
import AgentServerDesignSystem

#if DEBUG
enum UITestScenario: String {
    case creation
    case debugger
    case security
    case highRiskCreation = "high-risk-creation"
    case runtimeCreation = "runtime-creation"
    case runReview = "run-review"
    case todayActivity = "today-activity"
    case assistantHome = "assistant-home"

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
        case .runtimeCreation:
            runtimeCreationView
        case .runReview:
            RunReviewSummaryView(review: Self.completedRunReview)
        case .todayActivity:
            TodayActivityScenarioView()
        case .assistantHome:
            AssistantHomeView(
                presentation: AssistantHomePresentation(contract: DemoAssistantHome.ready()),
                onPrimaryAction: { _ in },
                onSecondaryAction: { _ in },
                onOpenRun: { _ in }
            )
        case .debugger:
            debuggerView
        case .security:
            SecurityScenarioView()
        }
    }

    private var runtimeCreationView: some View {
        GuidedAgentCreationView(
            actions: GuidedAgentCreationActions(
                prepare: { _, answers in
                    guard answers["runtime"] != nil else {
                        return .success(.questions([Self.runtimeQuestion]))
                    }
                    return .success(.proposal(Self.readOnlyProposal))
                },
                save: { _, _ in
                    .success(SavedAgentPresentation(agentId: "runtime-agent", safeTestRunId: nil))
                }
            ),
            onCancel: {},
            onCreated: { _ in }
        )
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

    private static let runtimeQuestion = CreationQuestion(
        id: "runtime",
        prompt: "Which LLM should this agent use?",
        kind: .runtime([
            CreationRuntimeOption(label: "Codex", value: "codex"),
            CreationRuntimeOption(label: "Claude Code", value: "claude-code"),
            CreationRuntimeOption(
                label: "Kimi Code",
                value: "kimi-code",
                disabledReason: "Can't enforce file access."
            ),
        ]),
        isRequired: true
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

    private static let completedRunReview = RunReview(
        outcome: .succeeded,
        headline: PresentationStatement(
            text: "Weekly report finished",
            evidenceReferences: ["run.status"]
        ),
        summary: PresentationStatement(
            text: "Prepared the weekly report and saved it to the approved folder.",
            evidenceReferences: ["run.summary"]
        ),
        accomplishments: [],
        changes: [PresentationStatement(
            text: "Updated weekly-report.md",
            evidenceReferences: ["run.filesWritten[0]"]
        )],
        outputs: [PresentationStatement(
            text: "Weekly report is ready",
            evidenceReferences: ["agent.output.primary", "run.status"]
        )],
        problems: [],
        suggestions: [],
        timeline: [
            HumanTimelineEntry(
                kind: .started,
                label: PresentationStatement(
                    text: "Started",
                    evidenceReferences: ["run.startedAt"]
                ),
                occurredAt: "2026-08-02T08:00:00.000Z"
            ),
            HumanTimelineEntry(
                kind: .read,
                label: PresentationStatement(
                    text: "Read project notes",
                    evidenceReferences: ["run.filesRead[0]"]
                ),
                occurredAt: nil
            ),
            HumanTimelineEntry(
                kind: .produced,
                label: PresentationStatement(
                    text: "Created the weekly report",
                    evidenceReferences: ["agent.output.primary"]
                ),
                occurredAt: nil
            ),
            HumanTimelineEntry(
                kind: .finished,
                label: PresentationStatement(
                    text: "Finished",
                    evidenceReferences: ["run.status"]
                ),
                occurredAt: "2026-08-02T08:02:00.000Z"
            ),
        ],
        operationalCompleteness: .complete,
        technicalDetailsReference: "/runs/run-review-fixture"
    )
}

private struct TodayActivityScenarioView: View {
    @State private var isInteractionPresented = false

    private let snapshot = DemoTodayActivitySnapshot.make(referenceDate: Date())

    init() {
        let shouldOpenInteraction = ProcessInfo.processInfo.environment[
            "AGENT_SERVER_UI_TEST_OPEN_INTERACTION"
        ] == "true"
        _isInteractionPresented = State(initialValue: shouldOpenInteraction)
    }

    var body: some View {
        VStack(spacing: 0) {
            ActivityView(
                items: snapshot.makeActivityPresentation(filter: .all).items,
                onOpen: { _ in }
            )
        }
        .sheet(isPresented: $isInteractionPresented) {
            if let interaction = Self.interaction {
                InteractionResponseSheet(
                    interaction: interaction,
                    submit: { _ in throw UITestScenarioError.submissionUnavailable },
                    onAccepted: { _ in isInteractionPresented = false }
                )
            }
        }
    }

    private static let interaction: LocalInteraction? = {
        let json = """
        {
          "interaction_id": "interaction-review-draft",
          "run_id": "run-needs-you",
          "assistant_id": "weekly-report",
          "message": "The weekly report is ready. What should happen next?",
          "options": [
            {
              "index": 0,
              "label": "Publish the draft",
              "description": "Send the reviewed report to the connected workspace."
            },
            {
              "index": 1,
              "label": "Keep it as a draft",
              "description": "Leave the report on this Mac without publishing it."
            }
          ],
          "allows_free_text": true,
          "expires_at": "2030-08-02T18:00:00.000Z",
          "status": "pending"
        }
        """
        return try? JSONDecoder().decode(LocalInteraction.self, from: Data(json.utf8))
    }()
}

private enum UITestScenarioError: LocalizedError {
    case submissionUnavailable

    var errorDescription: String? {
        "Submission is disabled in this preview."
    }
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
                reviewFix: { _ in .success(GuidancePatchPreview(
                    resultContentHash: "sha256:preview",
                    changes: [.init(field: "tools", summary: "Turn off command access")],
                    advancedChanges: .object(["tools": .array([.string("Read")])]),
                    risk: "low",
                    requiresConfirmation: false,
                    canApply: true
                )) },
                applyFix: { .success(store.apply(findingId: $0)) },
                ignore: { findingId, _ in .success(store.apply(findingId: findingId)) },
                approveAutomaticRuns: { .success(store.scan) }
            )
        )
    }
}
#endif
