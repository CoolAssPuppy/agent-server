import SwiftUI
import UniformTypeIdentifiers
import NerdsUI
import AppKit

enum CreationPreparation {
    case questions([CreationQuestion])
    case proposal(AgentProposalPresentation)
}

struct GuidedAgentCreationActions {
    let prepare: (String, [String: String]) async -> Result<CreationPreparation, ConsumerFlowFailure>
    let save: (AgentProposalPresentation, Bool) async -> Result<SavedAgentPresentation, ConsumerFlowFailure>
}

struct GuidedAgentCreationView: View {
    let actions: GuidedAgentCreationActions
    let onCancel: () -> Void
    let onCreated: (SavedAgentPresentation) -> Void
    var copy: GuidedAgentCreationCopy = .newAgent
    var setUpConnections: ((@escaping () -> Void) -> Void)? = nil

    @Environment(\.nTheme) private var theme
    @State private var request = ""
    @State private var answer = ""
    @State private var scheduleAnswer = ScheduleDraft()
    @State private var isChoosingFolder = false
    @State private var flow = AgentCreationFlow(request: "")
    @State private var pendingHighRiskSave: Bool?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.lg) {
                    content
                }
                .frame(maxWidth: 720)
                .padding(NSpacing.xl)
            }
            footer
        }
        .frame(minWidth: 680, minHeight: 600)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .shadow(color: Color.black.opacity(0.18), radius: 14, x: 5, y: 0)
        .fileImporter(
            isPresented: $isChoosingFolder,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false,
            onCompletion: chooseFolder
        )
        .confirmationDialog(
            "Save a high-risk agent?",
            isPresented: Binding(
                get: { pendingHighRiskSave != nil },
                set: { if !$0 { pendingHighRiskSave = nil } }
            ),
            presenting: pendingHighRiskSave
        ) { runSafeTest in
            Button("Save reviewed agent") { save(runSafeTest: runSafeTest) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text(flow.proposal?.riskReason ?? "Review this agent's access before saving.")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.phase {
        case .request:
            requestStep
        case .questions:
            questionStep
        case .preparingProposal:
            ConsumerProgressView(
                title: "Preparing your agent",
                message: "Checking what it needs and choosing safe defaults."
            )
        case .proposal:
            if let proposal = flow.proposal { proposalStep(proposal) }
        case .saving:
            ConsumerProgressView(title: "Saving your agent", message: "Your reviewed settings are being saved locally.")
        case .testing:
            ConsumerProgressView(title: "Running a safe test", message: "You can stop the run from its run details.")
        case .complete:
            completionStep
        case .failed:
            if let failure = flow.failure {
                ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? retry : nil)
            }
        }
    }

    private var requestStep: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(
                title: copy.title,
                explanation: copy.explanation
            )
            TextEditor(text: $request)
                .font(.system(.title3))
                .scrollContentBackground(.hidden)
                .padding(NSpacing.md)
                .frame(minHeight: 180)
                .background(theme.tokens.card)
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
                .overlay { RoundedRectangle(cornerRadius: NRadius.md).strokeBorder(theme.tokens.border) }
                .accessibilityLabel("Describe what this agent should do")
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationRequest)
            Text(copy.example)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }

    @ViewBuilder
    private var questionStep: some View {
        if let question = flow.nextQuestion {
            ConsumerFlowHeader(title: question.prompt, explanation: "This detail is needed before the agent can be saved.")
            ConsumerSection("Your answer") {
                questionControl(question)
            }
        }
    }

    @ViewBuilder
    private func questionControl(_ question: CreationQuestion) -> some View {
        switch question.kind {
        case .text:
            TextField("Type your answer", text: $answer)
                .textFieldStyle(.roundedBorder)
        case .folder:
            HStack {
                Text(answer.isEmpty ? "No folder selected" : answer)
                    .foregroundStyle(answer.isEmpty ? theme.tokens.mutedForeground : theme.tokens.foreground)
                    .lineLimit(1)
                Spacer()
                Button("Choose folder") { isChoosingFolder = true }
                    .accessibilityIdentifier(ConsumerFlowAccessibility.creationFolderPicker)
            }
        case .schedule:
            ScheduleField(draft: $scheduleAnswer)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Choose when this agent runs")
        case .choice(let choices):
            if choices.isEmpty, question.id == "calendar-id" {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    Label(
                        "Calendar access is not available yet.",
                        systemImage: "calendar.badge.exclamationmark"
                    )
                    Text("Allow Agent Server to view calendars in System Settings, then check again.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    HStack {
                        Button("Open System Settings", action: openCalendarPrivacySettings)
                        Button("Check again", action: startPreparation)
                            .buttonStyle(.borderedProminent)
                    }
                }
            } else {
                Picker("Choose one", selection: $answer) {
                    Text("Choose…").tag("")
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, label in
                        Text(label).tag(index < question.choiceValues.count ? question.choiceValues[index] : label)
                    }
                }
            }
        case .service(let choices):
            if choices.isEmpty {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    Label("Notion needs to be connected", systemImage: "link.badge.plus")
                    Text("Choose an existing Notion connection or add one before this agent can save results.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Button("Set up apps and services", action: requestConnectionSetup)
                        .buttonStyle(.borderedProminent)
                }
            } else {
                Picker("Notion connection", selection: $answer) {
                    Text("Choose…").tag("")
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, label in
                        Text(label).tag(index < question.choiceValues.count ? question.choiceValues[index] : label)
                    }
                }
            }
        case .confirmation:
            Picker("Choose one", selection: $answer) {
                Text("Choose…").tag("")
                Text("Yes").tag("Yes")
                Text("No").tag("No")
            }
        }
    }

    private func proposalStep(_ proposal: AgentProposalPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(title: "Review your agent", explanation: "Check what it will do and what it can access before saving.")
            AgentProposalView(
                proposal: proposal,
                onSetUpConnections: setUpConnections == nil ? nil : requestConnectionSetup
            )
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationReview)
        }
    }

    private var completionStep: some View {
        ConsumerSection("Agent saved") {
            Label("Your agent is ready.", systemImage: "checkmark.circle")
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.success)
        }
    }

    private var footer: some View {
        HStack(spacing: NSpacing.sm) {
            Button("Cancel", action: onCancel)
                .keyboardShortcut(.cancelAction)
                .disabled(isBusy)
            Spacer()
            footerActions
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
        .background(.bar)
    }

    @ViewBuilder
    private var footerActions: some View {
        switch flow.phase {
        case .request:
            Button("Continue", action: startPreparation)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationContinue)
        case .questions:
            Button("Continue", action: answerQuestion)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(currentAnswer.isEmpty)
        case .proposal:
            Button("Edit details") { flow.returnToRequest() }
            Button("Save agent") { requestSave(runSafeTest: false) }
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationSave)
            Button("Save and run a safe test") { requestSave(runSafeTest: true) }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationSaveAndTest)
        case .complete:
            Button("Done", action: onCancel)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        default:
            EmptyView()
        }
    }

    private func startPreparation() {
        flow = AgentCreationFlow(request: request)
        flow.beginProposalRequest()
        prepare()
    }

    private func openCalendarPrivacySettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") else { return }
        NSWorkspace.shared.open(url)
    }

    private func answerQuestion() {
        guard let question = flow.nextQuestion else { return }
        flow.answer(questionId: question.id, value: currentAnswer)
        answer = ""
        scheduleAnswer = ScheduleDraft()
        if flow.canRequestProposal {
            flow.beginProposalRequest()
            prepare()
        }
    }

    private func prepare() {
        Task {
            switch await actions.prepare(flow.request, flow.answers) {
            case .success(.questions(let questions)):
                flow.receiveQuestions(questions)
                if flow.canRequestProposal {
                    flow.beginProposalRequest()
                    prepare()
                }
            case .success(.proposal(let proposal)): flow.receiveProposal(proposal)
            case .failure(let failure): flow.fail(failure)
            }
        }
    }

    private func save(runSafeTest: Bool) {
        guard let proposal = flow.proposal else { return }
        flow.beginSave(runSafeTest: runSafeTest)
        Task {
            switch await actions.save(proposal, runSafeTest) {
            case .success(let result):
                flow.didSave()
                if runSafeTest { flow.completeTest() }
                onCreated(result)
            case .failure(let failure): flow.fail(failure)
            }
        }
    }

    private func requestSave(runSafeTest: Bool) {
        guard let risk = flow.proposal?.risk else { return }
        if risk == .high || risk == .critical {
            pendingHighRiskSave = runSafeTest
        } else {
            save(runSafeTest: runSafeTest)
        }
    }

    private func requestConnectionSetup() {
        setUpConnections? {
            flow.beginProposalRequest()
            prepare()
        }
    }

    private var isBusy: Bool {
        switch flow.phase {
        case .preparingProposal, .saving, .testing: return true
        default: return false
        }
    }

    private func retry() {
        flow.retry()
        if flow.phase == .request { return }
    }

    private func chooseFolder(_ result: Result<[URL], Error>) {
        if case .success(let urls) = result, let url = urls.first { answer = url.path(percentEncoded: false) }
    }

    private var currentAnswer: String {
        guard flow.nextQuestion?.kind == .schedule else { return answer }
        return scheduleAnswer.cronExpression ?? "manual"
    }
}
