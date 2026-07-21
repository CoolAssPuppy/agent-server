import Foundation

public enum CreationPreparation: Equatable, Sendable {
    case questions([CreationQuestion])
    case proposal(AgentProposalPresentation)
}

public struct GuidedPreparationRequest: Equatable, Sendable {
    public let generation: Int
    public let request: String
    public let answers: [String: CreationAnswerValue]
    public let newUnsupportedServiceIDs: [String]
}

public struct GuidedSaveRequest: Equatable, Sendable {
    public let generation: Int
    public let proposal: AgentProposalPresentation
    public let runSafeTest: Bool
}

public enum GuidedSaveDecision: Equatable, Sendable {
    case confirmationRequired(runSafeTest: Bool)
    case save(GuidedSaveRequest)
}

public struct GuidedSafeTestObservation: Equatable, Sendable {
    public let generation: Int
    public let runId: String
}

public struct GuidedAgentCreationModel: Equatable, Sendable {
    public var request: String
    public var answer = ""
    public var scheduleCron: String?
    public var resources = CreationResourceSelection()
    public var pickerError: String?
    public var flow: AgentCreationFlow
    public private(set) var pendingHighRiskSave: Bool?
    public private(set) var safeTestObservation: GuidedSafeTestObservation?

    private var unsupportedServiceTracker = UnsupportedServiceTelemetryTracker()
    private var nextGeneration = 0
    private var preparationGeneration: Int?
    private var saveGeneration: Int?

    public init(request: String = "") {
        self.request = request
        self.flow = AgentCreationFlow(request: request)
    }

    public var currentAnswer: CreationAnswerValue? {
        switch flow.nextQuestion?.kind {
        case .schedule: .string(scheduleCron ?? "manual")
        case .fileAccess: .fileGrants(resources.grants)
        case .none: nil
        default: .string(answer)
        }
    }

    public var canSubmitCurrentAnswer: Bool {
        flow.nextQuestion?.isAnswered(by: currentAnswer) ?? false
    }

    public var isBusy: Bool {
        switch flow.phase {
        case .preparingProposal, .saving, .testing: true
        default: false
        }
    }

    public mutating func startPreparation() -> GuidedPreparationRequest? {
        let unsupportedIDs = UnsupportedCreationServiceClassifier.serviceIDs(in: request)
        let newIDs = unsupportedServiceTracker.newServiceIDs(from: unsupportedIDs)
        flow.reviseRequest(request)
        return beginPreparation(newUnsupportedServiceIDs: newIDs)
    }

    public mutating func requestProposal() -> GuidedPreparationRequest? {
        beginPreparation(newUnsupportedServiceIDs: [])
    }

    public mutating func answerCurrentQuestion() -> GuidedPreparationRequest? {
        guard let question = flow.nextQuestion,
              let currentAnswer,
              question.isAnswered(by: currentAnswer) else { return nil }
        flow.answer(questionId: question.id, value: currentAnswer)
        clearQuestionDraft()
        return flow.canRequestProposal ? beginPreparation(newUnsupportedServiceIDs: []) : nil
    }

    public mutating func answer(questionId: String, value: String) {
        flow.answer(questionId: questionId, value: value)
    }

    public mutating func deferConnectionSetup() {
        flow.deferConnectionSetup()
    }

    @discardableResult
    public mutating func receivePreparation(
        _ result: Result<CreationPreparation, ConsumerFlowFailure>,
        generation: Int
    ) -> Bool {
        guard generation == preparationGeneration, flow.phase == .preparingProposal else {
            return false
        }
        preparationGeneration = nil
        switch result {
        case .success(.questions(let questions)):
            flow.receiveQuestions(questions)
            if flow.canRequestProposal { flow.fail(Self.repeatedQuestionsFailure) }
        case .success(.proposal(let proposal)):
            flow.receiveProposal(proposal)
        case .failure(let failure):
            flow.fail(failure)
        }
        return true
    }

    public mutating func refreshQuestion() -> GuidedPreparationRequest? {
        guard flow.beginQuestionRefresh() else { return nil }
        return makePreparationRequest(newUnsupportedServiceIDs: [])
    }

    public mutating func goBack() {
        invalidateAsyncWork()
        flow.goBack()
        restoreQuestionDraft()
    }

    public mutating func returnToRequest() {
        invalidateAsyncWork()
        flow.returnToRequest()
    }

    public mutating func retry() -> GuidedPreparationRequest? {
        flow.retry()
        return flow.canRequestProposal ? beginPreparation(newUnsupportedServiceIDs: []) : nil
    }

    public mutating func requestSave(runSafeTest: Bool) -> GuidedSaveDecision? {
        guard let proposal = flow.proposal else { return nil }
        if proposal.risk == .high || proposal.risk == .critical {
            pendingHighRiskSave = runSafeTest
            return .confirmationRequired(runSafeTest: runSafeTest)
        }
        return .save(beginSave(proposal: proposal, runSafeTest: runSafeTest))
    }

    public mutating func cancelHighRiskSave() {
        pendingHighRiskSave = nil
    }

    public mutating func confirmHighRiskSave() -> GuidedSaveRequest? {
        guard let runSafeTest = pendingHighRiskSave, let proposal = flow.proposal else { return nil }
        pendingHighRiskSave = nil
        return beginSave(proposal: proposal, runSafeTest: runSafeTest)
    }

    @discardableResult
    public mutating func receiveSave(
        _ result: Result<SavedAgentPresentation, ConsumerFlowFailure>,
        generation: Int
    ) -> Bool {
        guard generation == saveGeneration, flow.phase == .saving else { return false }
        saveGeneration = nil
        switch result {
        case .success(let saved):
            flow.didSave(saved)
            if let runId = saved.safeTestRunId, flow.phase == .testing {
                safeTestObservation = GuidedSafeTestObservation(
                    generation: generate(),
                    runId: runId
                )
            }
        case .failure(let failure):
            flow.fail(failure)
        }
        return true
    }

    @discardableResult
    public mutating func receiveSafeTest(
        _ state: SafeTestRunState,
        generation: Int
    ) -> Bool {
        receiveSafeTest(.success(state), generation: generation)
    }

    @discardableResult
    public mutating func receiveSafeTest(
        _ result: Result<SafeTestRunState, ConsumerFlowFailure>,
        generation: Int
    ) -> Bool {
        guard generation == safeTestObservation?.generation, flow.phase == .testing else {
            return false
        }
        switch result {
        case .success(let state):
            flow.updateSafeTest(state)
            if state != .running { safeTestObservation = nil }
        case .failure(let failure):
            safeTestObservation = nil
            flow.fail(failure)
        }
        return true
    }

    public mutating func stopSafeTest() -> String? {
        guard let runId = safeTestObservation?.runId else { return nil }
        safeTestObservation = nil
        flow.updateSafeTest(.stopped)
        return runId
    }

    public mutating func cancelSafeTestObservation() {
        safeTestObservation = nil
    }

    private mutating func beginPreparation(
        newUnsupportedServiceIDs: [String]
    ) -> GuidedPreparationRequest? {
        guard flow.canRequestProposal else { return nil }
        flow.beginProposalRequest()
        return makePreparationRequest(newUnsupportedServiceIDs: newUnsupportedServiceIDs)
    }

    private mutating func makePreparationRequest(
        newUnsupportedServiceIDs: [String]
    ) -> GuidedPreparationRequest {
        let generation = generate()
        preparationGeneration = generation
        return GuidedPreparationRequest(
            generation: generation,
            request: flow.request,
            answers: flow.answers,
            newUnsupportedServiceIDs: newUnsupportedServiceIDs
        )
    }

    private mutating func beginSave(
        proposal: AgentProposalPresentation,
        runSafeTest: Bool
    ) -> GuidedSaveRequest {
        flow.beginSave(runSafeTest: runSafeTest)
        let generation = generate()
        saveGeneration = generation
        return GuidedSaveRequest(
            generation: generation,
            proposal: proposal,
            runSafeTest: runSafeTest
        )
    }

    private mutating func generate() -> Int {
        nextGeneration += 1
        return nextGeneration
    }

    private mutating func invalidateAsyncWork() {
        preparationGeneration = nil
        saveGeneration = nil
        safeTestObservation = nil
    }

    private mutating func clearQuestionDraft() {
        answer = ""
        scheduleCron = nil
        resources = CreationResourceSelection()
        pickerError = nil
    }

    private mutating func restoreQuestionDraft() {
        clearQuestionDraft()
        guard let question = flow.nextQuestion, let saved = flow.answers[question.id] else { return }
        switch saved {
        case .string(let value):
            if case .schedule = question.kind { scheduleCron = value } else { answer = value }
        case .fileGrants(let grants):
            resources = CreationResourceSelection(grants: grants)
        }
    }

    private static let repeatedQuestionsFailure = ConsumerFlowFailure(
        title: "The suggestion needs another try",
        message: "The creation service could not finish a proposal from the answers you already provided.",
        recovery: "Try again. Your description and selected access will be kept.",
        technicalDetails: "The proposal service returned questions that were already answered.",
        didSave: false,
        canRetry: true
    )
}
