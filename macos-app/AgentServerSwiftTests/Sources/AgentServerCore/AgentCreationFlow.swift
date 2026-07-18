import Foundation

public struct CreationFileGrant: Codable, Equatable, Sendable, Identifiable {
    public enum Kind: String, Codable, Equatable, Sendable { case file, folder }
    public enum Access: String, Codable, Equatable, Sendable {
        case readOnly = "read_only"
        case readWrite = "read_write"
    }

    public let path: String
    public let kind: Kind
    public let access: Access
    public var id: String { path }

    public init(path: String, kind: Kind, access: Access) {
        self.path = path
        self.kind = kind
        self.access = access
    }
}

public enum CreationAnswerValue: Equatable, Sendable {
    case string(String)
    case fileGrants([CreationFileGrant])

    public var isEmpty: Bool {
        switch self {
        case .string(let value): value.isEmpty
        case .fileGrants(let grants): grants.isEmpty
        }
    }
}

public struct CreationQuestion: Identifiable, Equatable, Sendable {
    public enum NativeResource: Equatable, Sendable {
        case calendar
        case reminders
    }

    public enum Kind: Equatable, Sendable {
        case text
        case folder
        case fileAccess
        case schedule
        case choice([String])
        case service(name: String?, choices: [String])
        case confirmation
    }

    public let id: String
    public let prompt: String
    public let kind: Kind
    public let isRequired: Bool
    public let choiceValues: [String]

    public var requiresConnectionSetup: Bool {
        if case .service(_, let choices) = kind { return choices.isEmpty }
        return false
    }

    public var unavailableNativeResource: NativeResource? {
        guard case .choice(let choices) = kind, choices.isEmpty else { return nil }
        switch id {
        case "calendar-id": return .calendar
        case "reminder-list-id": return .reminders
        default: return nil
        }
    }

    public init(id: String, prompt: String, kind: Kind, isRequired: Bool, choiceValues: [String] = []) {
        self.id = id
        self.prompt = prompt
        self.kind = kind
        self.isRequired = isRequired
        self.choiceValues = choiceValues
    }
}

public struct ConsumerFlowFailure: Error, Equatable, Sendable {
    public let title: String
    public let message: String
    public let recovery: String
    public let technicalDetails: String
    public let didSave: Bool
    public let canRetry: Bool

    public init(
        title: String,
        message: String,
        recovery: String,
        technicalDetails: String,
        didSave: Bool,
        canRetry: Bool
    ) {
        self.title = title
        self.message = message
        self.recovery = recovery
        self.technicalDetails = technicalDetails
        self.didSave = didSave
        self.canRetry = canRetry
    }
}

public struct SavedAgentPresentation: Equatable, Sendable {
    public let agentId: String
    public let safeTestRunId: String?

    public init(agentId: String, safeTestRunId: String?) {
        self.agentId = agentId
        self.safeTestRunId = safeTestRunId
    }
}

public struct AgentCreationFlow: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case request
        case questions
        case preparingProposal
        case proposal
        case saving
        case testing
        case complete
        case failed
    }

    public private(set) var phase: Phase
    public let request: String
    public private(set) var questions: [CreationQuestion]
    public private(set) var answers: [String: CreationAnswerValue]
    public private(set) var proposal: AgentProposalPresentation?
    public private(set) var failure: ConsumerFlowFailure?
    public private(set) var shouldRunSafeTest: Bool
    public private(set) var hasSaved: Bool

    public init(request: String) {
        self.phase = .request
        self.request = request
        self.questions = []
        self.answers = [:]
        self.shouldRunSafeTest = false
        self.hasSaved = false
    }

    public var nextQuestion: CreationQuestion? {
        questions.first { $0.isRequired && answers[$0.id] == nil }
    }

    public var canRequestProposal: Bool {
        !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && nextQuestion == nil
    }

    public var canRetry: Bool { failure?.canRetry == true }

    public mutating func receiveQuestions(_ questions: [CreationQuestion]) {
        for question in questions {
            if case .string? = answers[question.id] {
                answers.removeValue(forKey: question.id)
            }
        }
        self.questions = questions
        phase = .questions
    }

    public mutating func answer(questionId: String, value: String) {
        answer(questionId: questionId, value: .string(value))
    }

    public mutating func answer(questionId: String, value: CreationAnswerValue) {
        guard questions.contains(where: { $0.id == questionId }) else { return }
        answers[questionId] = value
    }

    public mutating func beginProposalRequest() {
        guard canRequestProposal else { return }
        phase = .preparingProposal
        failure = nil
    }

    public mutating func receiveProposal(_ proposal: AgentProposalPresentation) {
        self.proposal = proposal
        failure = nil
        phase = .proposal
    }

    public mutating func returnToRequest() {
        guard phase == .proposal || phase == .questions else { return }
        questions = []
        answers = [:]
        proposal = nil
        failure = nil
        phase = .request
    }

    public mutating func beginSave(runSafeTest: Bool) {
        guard proposal != nil else { return }
        shouldRunSafeTest = runSafeTest
        failure = nil
        phase = .saving
    }

    public mutating func didSave() {
        hasSaved = true
        phase = shouldRunSafeTest ? .testing : .complete
    }

    public mutating func completeTest() { phase = .complete }

    public mutating func fail(_ failure: ConsumerFlowFailure) {
        self.failure = failure
        hasSaved = failure.didSave
        phase = .failed
    }

    public mutating func retry() {
        guard canRetry else { return }
        failure = nil
        phase = proposal == nil ? .request : .proposal
    }
}
