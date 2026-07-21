import SwiftUI
import AgentServerDesignSystem

struct GuidedAgentCreationActions {
    let prepare: (String, [String: CreationAnswerValue]) async -> Result<CreationPreparation, ConsumerFlowFailure>
    let save: (AgentProposalPresentation, Bool) async -> Result<SavedAgentPresentation, ConsumerFlowFailure>
    let safeTestState: (String) async -> Result<SafeTestRunState, ConsumerFlowFailure>
    let stopSafeTest: (String) -> Void

    init(
        prepare: @escaping (String, [String: CreationAnswerValue]) async -> Result<CreationPreparation, ConsumerFlowFailure>,
        save: @escaping (AgentProposalPresentation, Bool) async -> Result<SavedAgentPresentation, ConsumerFlowFailure>,
        safeTestState: @escaping (String) async -> Result<SafeTestRunState, ConsumerFlowFailure> = { _ in .success(.completed) },
        stopSafeTest: @escaping (String) -> Void = { _ in }
    ) {
        self.prepare = prepare
        self.save = save
        self.safeTestState = safeTestState
        self.stopSafeTest = stopSafeTest
    }
}

struct GuidedAgentCreationView: View {
    let actions: GuidedAgentCreationActions
    let onCancel: () -> Void
    let onCreated: (SavedAgentPresentation) -> Void
    var onOpenRun: (String) -> Void = { _ in }
    var onTestFailed: (String) -> Void = { _ in }
    var copy: GuidedAgentCreationCopy = .newAgent
    var setUpConnections: ((@escaping () -> Void) -> Void)? = nil

    @Environment(\.nTheme) var theme
    @State var model = GuidedAgentCreationModel()
    @State var operationTask: Task<Void, Never>?
    @State var safeTestTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.lg) { content }
                    .frame(maxWidth: 720)
                    .padding(NSpacing.xl)
            }
            footer
        }
        .frame(minWidth: 680, minHeight: 600)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .shadow(color: Color.black.opacity(0.18), radius: 14, x: 5, y: 0)
        .confirmationDialog(
            "Save a high-risk agent?",
            isPresented: Binding(
                get: { model.pendingHighRiskSave != nil },
                set: { if !$0 { model.cancelHighRiskSave() } }
            )
        ) {
            Button("Save reviewed agent", action: confirmHighRiskSave)
            Button("Cancel", role: .cancel) { model.cancelHighRiskSave() }
        } message: {
            Text(model.flow.proposal?.riskReason ?? "Review this agent's access before saving.")
        }
        .onDisappear(perform: cancelAsyncWork)
    }

    @ViewBuilder
    var content: some View {
        switch model.flow.phase {
        case .request: requestStep
        case .questions: questionStep
        case .preparingProposal:
            ConsumerProgressView(
                title: "Preparing your agent",
                message: "Checking what it needs and choosing safe defaults."
            )
        case .proposal:
            if let proposal = model.flow.proposal { proposalStep(proposal) }
        case .saving:
            ConsumerProgressView(
                title: "Saving your agent",
                message: "Your reviewed settings are being saved locally."
            )
        case .testing:
            ConsumerProgressView(title: "Running a safe test")
        case .complete:
            completionStep
        case .failed:
            if let failure = model.flow.failure {
                ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? retry : nil)
            }
        }
    }

    var requestStep: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(title: copy.title, explanation: copy.explanation)
            TextEditor(text: $model.request)
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

    func startPreparation() {
        guard let request = model.startPreparation() else { return }
        if !request.newUnsupportedServiceIDs.isEmpty {
            Telemetry.capture(
                "agent_creation_unsupported_services_mentioned",
                properties: [
                    "service_ids": request.newUnsupportedServiceIDs,
                    "service_count": request.newUnsupportedServiceIDs.count,
                ]
            )
        }
        prepare(request)
    }

    func prepare(_ request: GuidedPreparationRequest) {
        operationTask?.cancel()
        operationTask = Task {
            await completePreparation(request)
        }
    }

    func completePreparation(_ request: GuidedPreparationRequest) async {
        let result = await actions.prepare(request.request, request.answers)
        guard !Task.isCancelled else { return }
        model.receivePreparation(result, generation: request.generation)
    }

    func submitConnectionSetup() {
        guard model.flow.areConnectionQuestionsAnswered,
              let request = model.requestProposal() else { return }
        prepare(request)
    }

    func deferConnectionSetup() {
        model.deferConnectionSetup()
        submitConnectionSetup()
    }

    func answerQuestion() {
        if let request = model.answerCurrentQuestion() { prepare(request) }
    }

    func refreshQuestion() {
        if let request = model.refreshQuestion() { prepare(request) }
    }

    func retry() {
        if let request = model.retry() { prepare(request) }
    }

    func goBack() {
        model.goBack()
    }

    func requestSave(runSafeTest: Bool) {
        guard let request = model.requestSave(runSafeTest: runSafeTest) else { return }
        save(request)
    }

    func confirmHighRiskSave() {
        guard let request = model.confirmHighRiskSave() else { return }
        save(request)
    }

    func save(_ request: GuidedSaveRequest) {
        operationTask?.cancel()
        operationTask = Task {
            let result = await actions.save(request.proposal, request.runSafeTest)
            guard !Task.isCancelled else { return }
            guard model.receiveSave(result, generation: request.generation) else { return }
            guard case .success(let saved) = result else { return }
            if let observation = model.safeTestObservation {
                observeSafeTest(observation, result: saved)
            } else {
                onCreated(saved)
            }
        }
    }

    func observeSafeTest(
        _ observation: GuidedSafeTestObservation,
        result: SavedAgentPresentation
    ) {
        safeTestTask?.cancel()
        safeTestTask = Task {
            let terminal = await RunTerminalObserver.wait {
                await actions.safeTestState(observation.runId)
            }
            guard !Task.isCancelled else { return }
            guard model.receiveSafeTest(
                terminal,
                generation: observation.generation
            ) else { return }
            switch terminal {
            case .success(let state):
                if state == .completed { onCreated(result) }
                if case .failed = state { onTestFailed(observation.runId) }
            case .failure:
                break
            }
        }
    }

    func stopSafeTest() {
        guard let runId = model.stopSafeTest() else { return }
        actions.stopSafeTest(runId)
        safeTestTask?.cancel()
    }

    func cancelAsyncWork() {
        operationTask?.cancel()
        safeTestTask?.cancel()
        model.invalidatePendingOperations()
    }

    func requestConnectionSetup() {
        setUpConnections? {
            if let request = model.requestProposal() { prepare(request) }
        }
    }
}
