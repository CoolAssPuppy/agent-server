import SwiftUI
import AppKit
import NerdsUI

struct AgentDebuggerActions {
    let diagnose: () async -> Result<DiagnosticPresentation, ConsumerFlowFailure>
    let applyFix: (ConfigurationFixPresentation) async -> Result<Void, ConsumerFlowFailure>
    let retry: () async -> Result<String, ConsumerFlowFailure>
}

struct AgentDebuggerView: View {
    let failedRunId: String
    let actions: AgentDebuggerActions
    let openAgentSettings: () -> Void
    let openRun: (String) -> Void

    @Environment(\.nTheme) private var theme
    @State private var flow: AgentDebuggerFlow
    @State private var showsTechnicalDetails = false

    init(
        failedRunId: String,
        actions: AgentDebuggerActions,
        openAgentSettings: @escaping () -> Void,
        openRun: @escaping (String) -> Void
    ) {
        self.failedRunId = failedRunId
        self.actions = actions
        self.openAgentSettings = openAgentSettings
        self.openRun = openRun
        _flow = State(initialValue: AgentDebuggerFlow(failedRunId: failedRunId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                ConsumerFlowHeader(
                    title: "Agent debugger",
                    explanation: "Understand what went wrong and review a safe fix before anything changes."
                )
                content
            }
            .frame(maxWidth: 760)
            .padding(NSpacing.xl)
        }
        .background(theme.tokens.background)
        .task {
            guard flow.phase == .idle else { return }
            await diagnose()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.phase {
        case .idle, .diagnosing:
            ConsumerProgressView(title: "Checking what went wrong", message: "Reviewing this run and the agent's current settings.")
        case .diagnosis:
            if let diagnosis = flow.diagnosis { diagnosisView(diagnosis) }
        case .fixReview:
            if let fix = flow.diagnosis?.recommendedFix { fixReview(fix) }
        case .applying:
            ConsumerProgressView(title: "Applying the approved fix", message: "Only the change shown in the review is being applied.")
        case .readyToRetry:
            readyToRetry
        case .retrying:
            ConsumerProgressView(title: "Trying again", message: "The original failed run is preserved in run history.")
        case .resolved:
            resolved
        case .failed:
            if let failure = flow.failure {
                ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? { Task { await diagnose() } } : nil)
            }
        }
    }

    private func diagnosisView(_ diagnosis: DiagnosticPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerSection("What went wrong") {
                Text(diagnosis.title)
                    .font(NTypography.headlineSmall)
                Text(diagnosis.explanation)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            ConsumerSection("Evidence") {
                ForEach(diagnosis.evidence.prefix(3), id: \.self) { fact in
                    Label(fact, systemImage: "info.circle")
                        .font(NTypography.bodyLarge)
                }
            }
            if let fix = diagnosis.recommendedFix {
                ConsumerSection("Recommended fix") {
                    Text(fix.title)
                        .font(NTypography.bodyMedium)
                    Text(fix.impact)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    HStack {
                        ConsumerRiskLabel(risk: fix.risk)
                        Spacer()
                        Button("Review fix") { flow.reviewRecommendedFix() }
                            .buttonStyle(.borderedProminent)
                            .keyboardShortcut(.defaultAction)
                            .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerReviewFix)
                    }
                }
            }
            actionsRow
            technicalDetails(diagnosis.technicalDetails)
        }
    }

    private var actionsRow: some View {
        HStack {
            Button("Retry without changes") { Task { await retryRun() } }
                .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerRetry)
            Button("Open agent settings", action: openAgentSettings)
            Spacer()
        }
    }

    private func fixReview(_ fix: ConfigurationFixPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerFlowHeader(title: "Review fix", explanation: "Nothing changes until you approve this update.")
            ConsumerSection("Changes") {
                ForEach(fix.changes, id: \.self) { change in
                    Label(change, systemImage: "arrow.right.circle")
                }
            }
            ConsumerSection("Safety impact") {
                HStack(alignment: .top) {
                    ConsumerRiskLabel(risk: fix.risk)
                    Text(fix.impact)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            DisclosureGroup("Advanced configuration diff", isExpanded: $showsTechnicalDetails) {
                Text(fix.technicalDiff)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.top, NSpacing.xs)
            }
            HStack {
                Button("Cancel") { flow.cancelFixReview() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Apply and retry") { Task { await applyAndRetry(fix) } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerApplyFix)
            }
        }
    }

    private var readyToRetry: some View {
        ConsumerSection("Fix applied") {
            Text("The approved change was saved. The original failed run is still available in run history.")
            Button("Retry now") { Task { await retryRun() } }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        }
    }

    private var resolved: some View {
        ConsumerSection("The fix worked") {
            Label("The new run completed successfully.", systemImage: "checkmark.circle")
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.success)
            if let tip = flow.diagnosis?.preventionTip {
                Text("To prevent this next time: \(tip)")
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            if let runId = flow.retryRunId {
                Button("Open successful run") { openRun(runId) }
            }
        }
    }

    private func technicalDetails(_ details: String) -> some View {
        DisclosureGroup("Technical details", isExpanded: $showsTechnicalDetails) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text(details)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                Button("Copy details") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(details, forType: .string)
                }
            }
            .padding(.top, NSpacing.xs)
        }
    }

    private func diagnose() async {
        flow.beginDiagnosis()
        switch await actions.diagnose() {
        case .success(let diagnosis): flow.receiveDiagnosis(diagnosis)
        case .failure(let failure): flow.fail(failure)
        }
    }

    private func applyAndRetry(_ fix: ConfigurationFixPresentation) async {
        flow.beginApply()
        switch await actions.applyFix(fix) {
        case .success:
            flow.didApplyFix()
            await retryRun()
        case .failure(let failure): flow.fail(failure)
        }
    }

    private func retryRun() async {
        flow.beginRetry()
        switch await actions.retry() {
        case .success(let runId):
            flow.didStartRetry(runId: runId)
            openRun(runId)
        case .failure(let failure): flow.fail(failure)
        }
    }
}
