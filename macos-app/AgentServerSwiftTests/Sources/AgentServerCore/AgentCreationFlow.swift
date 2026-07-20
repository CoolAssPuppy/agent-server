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

public enum CreationResourcePickerMode: Equatable, Sendable {
    case filesAndFolders
    case folder

    public var allowsMultipleSelection: Bool { self == .filesAndFolders }

    public func accepts(isDirectory: Bool) -> Bool {
        switch self {
        case .filesAndFolders: true
        case .folder: isDirectory
        }
    }
}

public enum CreationAnswerValue: Equatable, Sendable {
    public static let setUpLater = "__set_up_later__"

    case string(String)
    case fileGrants([CreationFileGrant])

    public var isEmpty: Bool {
        switch self {
        case .string(let value): value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .fileGrants(let grants): grants.isEmpty
        }
    }
}

public struct CreationQuestion: Identifiable, Equatable, Sendable {
    public enum NativeResource: Equatable, Sendable {
        case calendar
        case reminders
        case contacts
    }

    public enum Kind: Equatable, Sendable {
        case text
        case folder
        case fileAccess
        case schedule
        case choice([String])
        case service(name: String?, choices: [String])
        case confirmation
        case unavailable(message: String)
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

    public var serviceContextTitle: String? {
        guard case .service(let name, _) = kind, let name else { return nil }
        return "You mentioned \(name)"
    }

    public var serviceContextExplanation: String? {
        guard case .service(let name, _) = kind, let name else { return nil }
        return "Choose the \(name) account this agent should use."
    }

    public var isUnavailable: Bool {
        if case .unavailable = kind { return true }
        return false
    }

    public var unavailableNativeResource: NativeResource? {
        guard case .choice(let choices) = kind, choices.isEmpty else { return nil }
        switch id {
        case "calendar-id": return .calendar
        case "reminder-list-id": return .reminders
        case "contact-group-id": return .contacts
        default: return nil
        }
    }

    public func isAnswered(by answer: CreationAnswerValue?) -> Bool {
        guard let answer else { return false }
        if case .fileAccess = kind, case .fileGrants = answer {
            return true
        }
        return !answer.isEmpty
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
    public let didSave: Bool?
    public let canRetry: Bool

    public init(
        title: String,
        message: String,
        recovery: String,
        technicalDetails: String,
        didSave: Bool?,
        canRetry: Bool
    ) {
        self.title = title
        self.message = message
        self.recovery = recovery
        self.technicalDetails = technicalDetails
        self.didSave = didSave
        self.canRetry = canRetry
    }

    public var conciseMessage: String {
        guard let didSave else { return message }
        let saveStatus = didSave ? "Your changes were saved." : "Nothing was saved."
        return "\(message) \(saveStatus)"
    }

    public var visibleRecovery: String? {
        canRetry ? nil : recovery
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

public enum SafeTestRunState: Equatable, Sendable {
    case running
    case completed
    case failed(String)
    case stopped
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
    public private(set) var request: String
    public private(set) var questions: [CreationQuestion]
    public private(set) var answers: [String: CreationAnswerValue]
    public private(set) var proposal: AgentProposalPresentation?
    public private(set) var failure: ConsumerFlowFailure?
    public private(set) var shouldRunSafeTest: Bool
    public private(set) var hasSaved: Bool
    public private(set) var savedAgent: SavedAgentPresentation?
    public private(set) var safeTestState: SafeTestRunState?
    private var questionHistory: [[CreationQuestion]]
    private var editingQuestionId: String?

    public init(request: String) {
        self.phase = .request
        self.request = request
        self.questions = []
        self.answers = [:]
        self.questionHistory = []
        self.shouldRunSafeTest = false
        self.hasSaved = false
    }

    public var safeTestRunId: String? { savedAgent?.safeTestRunId }

    public var failedSafeTestRunId: String? {
        guard case .failed? = safeTestState else { return nil }
        return safeTestRunId
    }

    public var nextQuestion: CreationQuestion? {
        if let editingQuestionId,
           let question = questions.first(where: { $0.id == editingQuestionId }) {
            return question
        }
        return questions.first { question in
            guard question.isRequired else { return false }
            return !question.isAnswered(by: answers[question.id])
        }
    }

    public var pendingConnectionQuestions: [CreationQuestion] {
        connectionQuestions.filter { $0.isRequired && answers[$0.id] == nil }
    }

    public var connectionQuestions: [CreationQuestion] {
        questions.filter {
            if case .service = $0.kind { return true }
            return false
        }
    }

    public var areConnectionQuestionsAnswered: Bool {
        !connectionQuestions.isEmpty && connectionQuestions.allSatisfy { question in
            guard let answer = answers[question.id] else { return false }
            return answer == .string(CreationAnswerValue.setUpLater) || !question.requiresConnectionSetup
        }
    }

    public var canRequestProposal: Bool {
        !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && nextQuestion == nil
    }

    public var canRetry: Bool { failure?.canRetry == true }

    public var canGoBack: Bool { phase == .questions || phase == .proposal }

    public mutating func receiveQuestions(_ questions: [CreationQuestion]) {
        if !self.questions.isEmpty, self.questions != questions {
            questionHistory.append(self.questions)
        }
        for question in questions {
            if case .string(let existing)? = answers[question.id] {
                if case .service = question.kind,
                   question.choiceValues.contains(existing) {
                    continue
                }
                answers.removeValue(forKey: question.id)
            }
            if question.id == "calendar-id" { answers.removeValue(forKey: "calendar-access") }
            if question.id == "reminder-list-id" { answers.removeValue(forKey: "reminder-actions") }
            if question.id == "contact-group-id" { answers.removeValue(forKey: "contact-fields") }
        }
        self.questions = questions
        editingQuestionId = nil
        phase = .questions
    }

    public mutating func answer(questionId: String, value: String) {
        answer(questionId: questionId, value: .string(value))
    }

    public mutating func answer(questionId: String, value: CreationAnswerValue) {
        guard questions.contains(where: { $0.id == questionId }) else { return }
        answers[questionId] = value
        if editingQuestionId == questionId { editingQuestionId = nil }
    }

    public mutating func deferConnectionSetup() {
        for question in connectionQuestions {
            answers[question.id] = .string(CreationAnswerValue.setUpLater)
        }
    }

    public mutating func goBack() {
        guard canGoBack else { return }
        if phase == .proposal {
            proposal = nil
            failure = nil
            guard !questions.isEmpty else {
                phase = .request
                return
            }
            phase = .questions
            activateLastQuestionForEditing()
            return
        }
        if let previousQuestions = questionHistory.popLast() {
            questions = previousQuestions
            phase = .questions
            activateLastQuestionForEditing()
            return
        }
        returnToRequest()
    }

    public mutating func beginProposalRequest() {
        guard canRequestProposal else { return }
        phase = .preparingProposal
        failure = nil
    }

    @discardableResult
    public mutating func beginQuestionRefresh() -> Bool {
        guard phase == .questions else { return false }
        failure = nil
        phase = .preparingProposal
        return true
    }

    public mutating func receiveProposal(_ proposal: AgentProposalPresentation) {
        self.proposal = proposal
        failure = nil
        phase = .proposal
    }

    public mutating func returnToRequest() {
        guard phase == .proposal || phase == .questions else { return }
        proposal = nil
        failure = nil
        questionHistory.removeAll()
        editingQuestionId = nil
        phase = .request
    }

    private mutating func activateLastQuestionForEditing() {
        editingQuestionId = connectionQuestions.isEmpty
            ? questions.last(where: \.isRequired)?.id
            : nil
    }

    public mutating func reviseRequest(_ request: String) {
        self.request = request
        proposal = nil
        failure = nil
    }

    public mutating func beginSave(runSafeTest: Bool) {
        guard proposal != nil else { return }
        shouldRunSafeTest = runSafeTest
        failure = nil
        phase = .saving
    }

    public mutating func didSave(_ result: SavedAgentPresentation) {
        savedAgent = result
        hasSaved = true
        phase = shouldRunSafeTest && result.safeTestRunId != nil ? .testing : .complete
    }

    public mutating func updateSafeTest(_ state: SafeTestRunState) {
        guard phase == .testing, safeTestRunId != nil else { return }
        switch state {
        case .running:
            safeTestState = .running
        case .completed:
            safeTestState = .completed
            phase = .complete
        case .failed(let details):
            safeTestState = state
            fail(.init(
                title: "The safe test found a problem",
                message: "Your agent was saved, but its first test did not finish successfully.",
                recovery: "Open Agent Debugger to see what happened and review a safe fix.",
                technicalDetails: details,
                didSave: true,
                canRetry: false
            ))
        case .stopped:
            safeTestState = .stopped
            phase = .complete
        }
    }

    public mutating func fail(_ failure: ConsumerFlowFailure) {
        self.failure = failure
        if let didSave = failure.didSave { hasSaved = didSave }
        phase = .failed
    }

    public mutating func retry() {
        guard canRetry else { return }
        failure = nil
        phase = proposal == nil ? .request : .proposal
    }
}
