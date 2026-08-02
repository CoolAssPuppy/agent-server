import SwiftUI
import AppKit
import AgentServerDesignSystem

struct AgentDebuggerActions {
    let diagnose: () async -> Result<DiagnosticPresentation, ConsumerFlowFailure>
    let applyFix: ((ConfigurationFixPresentation) async -> Result<Void, ConsumerFlowFailure>)?
    let retry: () async -> Result<String, ConsumerFlowFailure>
    let stopRun: (String) -> Void
    let runState: (String) async -> Result<SafeTestRunState, ConsumerFlowFailure>

    init(
        diagnose: @escaping () async -> Result<DiagnosticPresentation, ConsumerFlowFailure>,
        applyFix: ((ConfigurationFixPresentation) async -> Result<Void, ConsumerFlowFailure>)?,
        retry: @escaping () async -> Result<String, ConsumerFlowFailure>,
        stopRun: @escaping (String) -> Void,
        runState: @escaping (String) async -> Result<SafeTestRunState, ConsumerFlowFailure> = { _ in .success(.completed) }
    ) {
        self.diagnose = diagnose
        self.applyFix = applyFix
        self.retry = retry
        self.stopRun = stopRun
        self.runState = runState
    }
}

struct AgentDebuggerView: View {
    let failedRunId: String
    let actions: AgentDebuggerActions
    let openAgentSettings: () -> Void
    let openRun: (String) -> Void
    let showsHeading: Bool

    @Environment(\.nTheme) private var theme
    @State private var flow: AgentDebuggerFlow
    @State private var showsTechnicalDetails = false
    @State private var showsRetryConfirmation = false
    @State private var retryTask: Task<Void, Never>?

    init(
        failedRunId: String,
        actions: AgentDebuggerActions,
        openAgentSettings: @escaping () -> Void,
        openRun: @escaping (String) -> Void,
        showsHeading: Bool = true
    ) {
        self.failedRunId = failedRunId
        self.actions = actions
        self.openAgentSettings = openAgentSettings
        self.openRun = openRun
        self.showsHeading = showsHeading
        _flow = State(initialValue: AgentDebuggerFlow(failedRunId: failedRunId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                if showsHeading {
                    ConsumerFlowHeader(
                        title: "Agent debugger",
                        explanation: "Understand what went wrong and review a safe fix before anything changes."
                    )
                }
                content
            }
            .frame(maxWidth: 760)
            .padding(NSpacing.xl)
        }
        .task {
            guard flow.phase == .idle else { return }
            await diagnose()
        }
        .onDisappear { retryTask?.cancel() }
        .confirmationDialog(
            "Retry this assistant without changes?",
            isPresented: $showsRetryConfirmation,
            titleVisibility: .visible
        ) {
            Button("Retry") { Task { await retryRun() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The same problem may happen again. No settings will be changed.")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.phase {
        case .idle, .diagnosing:
            ConsumerProgressView(title: "Checking what went wrong")
        case .diagnosis:
            if let diagnosis = flow.diagnosis { diagnosisView(diagnosis) }
        case .fixReview:
            if let fix = flow.diagnosis?.recommendedFix { fixReview(fix) }
        case .applying:
            ConsumerProgressView(title: "Applying the approved fix", message: "Only the change shown in the review is being applied.")
        case .readyToRetry:
            readyToRetry
        case .retrying:
            retrying
        case .resolved:
            resolved
        case .failed:
            if let failure = flow.failure {
                VStack(alignment: .leading, spacing: NSpacing.md) {
                    ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? { Task { await diagnose() } } : nil)
                    if let runId = flow.retryRunId {
                        Button("Open retry run") { openRun(runId) }
                    }
                }
            }
        }
    }

    private func diagnosisView(_ diagnosis: DiagnosticPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerSection("What went wrong", style: sectionStyle) {
                Text(diagnosis.title)
                    .font(NTypography.bodyMedium)
                Text(diagnosis.explanation)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            if diagnosis.hasEvidence {
                Divider().opacity(0.3)
                ConsumerSection("Evidence", style: sectionStyle) {
                    ForEach(diagnosis.evidence.prefix(3), id: \.self) { fact in
                        Label(fact, systemImage: "info.circle")
                            .font(NTypography.bodyMedium)
                    }
                }
            }
            if let fix = diagnosis.recommendedFix {
                Divider().opacity(0.3)
                ConsumerSection("Recommended fix", style: sectionStyle) {
                    Text(fix.title)
                        .font(NTypography.bodyMedium)
                    Text(fix.impact)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    HStack {
                        ConsumerRiskLabel(risk: fix.risk)
                        Spacer()
                        if fix.canApply, actions.applyFix != nil {
                            Button("Review fix") { flow.reviewRecommendedFix() }
                                .buttonStyle(.borderedProminent)
                                .keyboardShortcut(.defaultAction)
                                .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerReviewFix)
                        }
                    }
                }
            }
            actionsRow
            if AgentDebuggerPresentation.disclosesTechnicalDetails {
                technicalDetails(diagnosis.technicalDetails)
            }
        }
    }

    private var actionsRow: some View {
        HStack {
            retryWithoutChangesAction
            Button("Open agent settings", action: openAgentSettings)
            Spacer()
        }
    }

    @ViewBuilder
    private var retryWithoutChangesAction: some View {
        switch flow.diagnosis?.rerunSafety ?? .confirm {
        case .safe:
            Button("Retry without changes") { Task { await retryRun() } }
                .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerRetry)
        case .confirm:
            Button("Retry without changes…") { showsRetryConfirmation = true }
                .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerRetry)
        case .unsafe:
            Label("Change the setup before trying again", systemImage: "exclamationmark.shield")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.warning)
                .accessibilityIdentifier("debugger.retryBlocked")
        }
    }

    private func fixReview(_ fix: ConfigurationFixPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerFlowHeader(title: "Review fix", explanation: "Nothing changes until you approve this update.")
            ConsumerSection("Changes", style: sectionStyle) {
                ForEach(fix.changes, id: \.self) { change in
                    Label(change, systemImage: "arrow.right.circle")
                }
            }
            Divider().opacity(0.3)
            ConsumerSection("Safety impact", style: sectionStyle) {
                HStack(alignment: .top) {
                    ConsumerRiskLabel(risk: fix.risk)
                    Text(fix.impact)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            if AgentDebuggerPresentation.disclosesTechnicalDetails {
                DisclosureGroup("Advanced configuration diff", isExpanded: $showsTechnicalDetails) {
                    Text(fix.technicalDiff)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(.top, NSpacing.xs)
                }
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
        ConsumerSection("Fix applied", style: sectionStyle) {
            Text("The approved change was saved. The original failed run is still available in run history.")
            Button("Retry now") { Task { await retryRun() } }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        }
    }

    private var retrying: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerProgressView(title: "Trying again", message: "The original failed run is preserved in run history.")
            if let runId = flow.retryRunId {
                HStack {
                    Button("Stop run") { stopRetry(runId) }
                    Button("Open run") { openRun(runId) }
                }
            }
        }
    }

    private var resolved: some View {
        ConsumerSection("The fix worked", style: sectionStyle) {
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

    private var sectionStyle: ConsumerSectionStyle {
        switch AgentDebuggerPresentation.surfaceStyle {
        case .flatSections: .flat
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
        guard let applyFix = actions.applyFix, fix.canApply else { return }
        flow.beginApply()
        switch await applyFix(fix) {
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
            observeRetry(runId)
        case .failure(let failure): flow.fail(failure)
        }
    }

    private func observeRetry(_ runId: String) {
        retryTask?.cancel()
        retryTask = Task {
            let observation = await RunTerminalObserver.wait {
                await actions.runState(runId)
            }
            guard !Task.isCancelled else { return }
            switch observation {
            case .success(let state):
                flow.updateRetry(runId: runId, state: state)
            case .failure(let failure):
                flow.fail(failure)
            }
        }
    }

    private func stopRetry(_ runId: String) {
        actions.stopRun(runId)
        retryTask?.cancel()
        flow.updateRetry(runId: runId, state: .stopped)
    }
}
