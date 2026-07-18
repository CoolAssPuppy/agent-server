import SwiftUI
import UniformTypeIdentifiers
import NerdsUI
import AppKit

private extension CreationQuestion.NativeResource {
    var unavailableTitle: String {
        switch self {
        case .calendar: "Calendar access is not available yet."
        case .reminders: "Reminder access is not available yet."
        case .contacts: "Contacts access is not available yet."
        }
    }

    var recoveryMessage: String {
        switch self {
        case .calendar: "Allow Agent Server to view calendars in System Settings, then check again."
        case .reminders: "Allow Agent Server to view reminders in System Settings, then check again."
        case .contacts: "Allow Agent Server to view contacts in System Settings, then check again."
        }
    }

    var systemImage: String {
        switch self {
        case .calendar: "calendar.badge.exclamationmark"
        case .reminders: "list.bullet.clipboard"
        case .contacts: "person.crop.circle.badge.exclamationmark"
        }
    }

    var privacySettingsURL: String {
        switch self {
        case .calendar: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
        case .reminders: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
        case .contacts: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"
        }
    }
}

enum CreationPreparation {
    case questions([CreationQuestion])
    case proposal(AgentProposalPresentation)
}

struct GuidedAgentCreationActions {
    let prepare: (String, [String: CreationAnswerValue]) async -> Result<CreationPreparation, ConsumerFlowFailure>
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
    @State private var fileGrants: [CreationFileGrant] = []
    @State private var pickerError: String?
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
            allowedContentTypes: flow.nextQuestion?.kind == .folder ? [.folder] : [.item],
            allowsMultipleSelection: flow.nextQuestion?.kind == .fileAccess,
            onCompletion: chooseFiles
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
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                HStack {
                    Text(answer.isEmpty ? "No folder selected" : answer)
                        .foregroundStyle(answer.isEmpty ? theme.tokens.mutedForeground : theme.tokens.foreground)
                        .lineLimit(1)
                    Spacer()
                    Button("Choose folder") { isChoosingFolder = true }
                        .accessibilityIdentifier(ConsumerFlowAccessibility.creationFolderPicker)
                }
                pickerFailure
            }
        case .fileAccess:
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                ForEach(fileGrants) { grant in
                    HStack(spacing: NSpacing.sm) {
                        Image(systemName: grant.kind == .folder ? "folder" : "doc")
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(URL(fileURLWithPath: grant.path).lastPathComponent)
                            Text(grant.path)
                                .font(NTypography.caption)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .lineLimit(1)
                        }
                        Spacer()
                        Picker("Access for \(grant.path)", selection: accessBinding(for: grant)) {
                            Text("View only").tag(CreationFileGrant.Access.readOnly)
                            Text("Can make changes").tag(CreationFileGrant.Access.readWrite)
                        }
                        .labelsHidden()
                        Button("Remove \(grant.path)", systemImage: "minus.circle") {
                            fileGrants.removeAll { $0.id == grant.id }
                        }
                        .labelStyle(.iconOnly)
                    }
                    .padding(NSpacing.sm)
                    .background(theme.tokens.card)
                    .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                Button(fileGrants.isEmpty ? "Choose files or folders" : "Add another file or folder") {
                    isChoosingFolder = true
                }
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationFolderPicker)
                Text("Set access for each item. View only is the safer default.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                pickerFailure
            }
        case .schedule:
            ScheduleField(draft: $scheduleAnswer)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Choose when this agent runs")
        case .choice(let choices):
            if let unavailableResource = question.unavailableNativeResource {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    Label(
                        unavailableResource.unavailableTitle,
                        systemImage: unavailableResource.systemImage
                    )
                    Text(unavailableResource.recoveryMessage)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    HStack {
                        Button("Allow access") { requestNativeAccess(unavailableResource) }
                            .buttonStyle(.borderedProminent)
                        Button("Open System Settings") { openPrivacySettings(for: unavailableResource) }
                        Button("Check again", action: refreshQuestion)
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
        case .service(let serviceName, let choices):
            if choices.isEmpty {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    Text("Agent Server will use this connection only for the access shown in your proposal.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Button("Set up apps and services", action: requestConnectionSetup)
                        .buttonStyle(.borderedProminent)
                }
            } else {
                Picker("\(serviceName ?? "App or service") connection", selection: $answer) {
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
            if flow.nextQuestion?.requiresConnectionSetup != true {
                Button("Continue", action: answerQuestion)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(currentAnswerValue?.isEmpty ?? true)
            }
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

    private func refreshQuestion() {
        flow.beginQuestionRefresh()
        prepare()
    }

    private func requestNativeAccess(_ resource: CreationQuestion.NativeResource) {
        Task {
            await EventKitPermissionManager().requestAccess(for: resource)
            refreshQuestion()
        }
    }

    private func openPrivacySettings(for resource: CreationQuestion.NativeResource) {
        guard let url = URL(string: resource.privacySettingsURL) else { return }
        NSWorkspace.shared.open(url)
    }

    private func answerQuestion() {
        guard let question = flow.nextQuestion, let currentAnswerValue else { return }
        flow.answer(questionId: question.id, value: currentAnswerValue)
        answer = ""
        scheduleAnswer = ScheduleDraft()
        fileGrants = []
        pickerError = nil
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
                    flow.fail(.init(
                        title: "The suggestion needs another try",
                        message: "The creation service could not finish a proposal from the answers you already provided.",
                        recovery: "Try again. Your description and selected access will be kept.",
                        technicalDetails: "The proposal service returned questions that were already answered.",
                        didSave: false,
                        canRetry: true
                    ))
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
        if flow.canRequestProposal {
            flow.beginProposalRequest()
            prepare()
        }
    }

    private func chooseFiles(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else {
            if case .failure(let error) = result {
                pickerError = "The selected item could not be opened. \(error.localizedDescription)"
            }
            return
        }
        pickerError = nil
        if flow.nextQuestion?.kind == .folder {
            guard let url = urls.first,
                  (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                pickerError = "Choose a folder, not a file."
                return
            }
            answer = url.path(percentEncoded: false)
            return
        }
        let additions = urls.compactMap { url -> CreationFileGrant? in
            guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey]),
                  let isDirectory = values.isDirectory else {
                pickerError = "One selected item could not be identified. Choose it again."
                return nil
            }
            return CreationFileGrant(
                path: url.path(percentEncoded: false),
                kind: isDirectory ? .folder : .file,
                access: .readOnly
            )
        }
        let existing = Set(fileGrants.map(\.path))
        fileGrants.append(contentsOf: additions.filter { !existing.contains($0.path) })
    }

    @ViewBuilder
    private var pickerFailure: some View {
        if let pickerError {
            Label(pickerError, systemImage: "exclamationmark.triangle")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.error)
                .accessibilityLabel("File selection error: \(pickerError)")
        }
    }

    private func accessBinding(for grant: CreationFileGrant) -> Binding<CreationFileGrant.Access> {
        Binding(
            get: { fileGrants.first(where: { $0.id == grant.id })?.access ?? grant.access },
            set: { access in
                guard let index = fileGrants.firstIndex(where: { $0.id == grant.id }) else { return }
                fileGrants[index] = CreationFileGrant(path: grant.path, kind: grant.kind, access: access)
            }
        )
    }

    private var currentAnswerValue: CreationAnswerValue? {
        switch flow.nextQuestion?.kind {
        case .schedule: .string(scheduleAnswer.cronExpression ?? "manual")
        case .fileAccess: .fileGrants(fileGrants)
        case .none: nil
        default: .string(answer)
        }
    }
}
