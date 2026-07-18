import Foundation

public enum GuidanceServerRoute: Equatable, Sendable {
    case createProposal
    case saveProposal(String)
    case diagnosis(String)
    case retry(String)
    case previewPatch
    case applyPatch
    case safeTest(String)
    case similarProposal(String)

    public var method: HTTPRequestMethod { .post }

    public var path: String {
        switch self {
        case .createProposal:
            return "/guidance/agent-proposals"
        case .saveProposal(let id):
            return "/guidance/agent-proposals/\(Self.pathSegment(id))/save"
        case .diagnosis(let id):
            return "/guidance/runs/\(Self.pathSegment(id))/diagnosis"
        case .retry(let id):
            return "/guidance/runs/\(Self.pathSegment(id))/retry"
        case .previewPatch:
            return "/configuration-patches/preview"
        case .applyPatch:
            return "/configuration-patches/apply"
        case .safeTest(let id):
            return "/agents/\(Self.pathSegment(id))/safe-test"
        case .similarProposal(let id):
            return "/guidance/agents/\(Self.pathSegment(id))/similar-proposals"
        }
    }

    public static var allCasesUsePost: Bool { true }

    private static func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}

public enum GuidanceProposalAnswerValue: Encodable, Equatable, Sendable {
    case string(String)
    case boolean(Bool)
    case strings([String])

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .strings(let value): try container.encode(value)
        }
    }
}

public struct GuidanceProposalAnswer: Encodable, Equatable, Sendable {
    public let questionId: String
    public let value: GuidanceProposalAnswerValue

    public init(questionId: String, value: GuidanceProposalAnswerValue) {
        self.questionId = questionId
        self.value = value
    }

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case value
    }
}

public struct GuidanceCalendarResource: Encodable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let account: String
    public let canModify: Bool

    public init(id: String, name: String, account: String, canModify: Bool) {
        self.id = id
        self.name = name
        self.account = account
        self.canModify = canModify
    }

    enum CodingKeys: String, CodingKey {
        case id, name, account
        case canModify = "can_modify"
    }
}

public struct GuidanceServiceRegistryResponse: Decodable, Equatable, Sendable {
    public let connections: [GuidanceServiceConnection]

    public var connectedServices: [GuidanceConnectedService] {
        connections
            .filter { $0.status == "connected" }
            .map {
                GuidanceConnectedService(
                    id: $0.id,
                    serviceId: $0.serviceId,
                    name: $0.name,
                    source: $0.source,
                    actions: $0.actions,
                    actionsKnown: $0.actionsKnown
                )
            }
    }
}

public struct GuidanceServiceConnection: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let serviceId: String
    public let name: String
    public let source: String
    public let status: String
    public let actions: [String]
    public let actionsKnown: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, source, status, actions
        case serviceId = "service_id"
        case actionsKnown = "actions_known"
    }
}

public struct GuidanceConnectedService: Encodable, Equatable, Sendable {
    public let id: String
    public let serviceId: String
    public let name: String
    public let source: String
    public let actions: [String]
    public let actionsKnown: Bool

    public init(
        id: String,
        serviceId: String,
        name: String,
        source: String,
        actions: [String],
        actionsKnown: Bool = true
    ) {
        self.id = id
        self.serviceId = serviceId
        self.name = name
        self.source = source
        self.actions = actions
        self.actionsKnown = actionsKnown
    }

    enum CodingKeys: String, CodingKey {
        case id, name, source, actions
        case serviceId = "service_id"
        case actionsKnown = "actions_known"
    }
}

public struct GuidanceProposalRequest: Encodable, Equatable, Sendable {
    public let request: String
    public let timezone: String
    public let connectedServices: [GuidanceConnectedService]
    public let availableCalendars: [GuidanceCalendarResource]
    public let answers: [GuidanceProposalAnswer]

    public init(
        request: String,
        timezone: String,
        connectedServices: [GuidanceConnectedService],
        availableCalendars: [GuidanceCalendarResource] = [],
        answers: [GuidanceProposalAnswer] = []
    ) {
        self.request = request
        self.timezone = timezone
        self.connectedServices = connectedServices
        self.availableCalendars = availableCalendars
        self.answers = answers
    }

    enum CodingKeys: String, CodingKey {
        case request, timezone, answers
        case connectedServices = "connected_services"
        case availableCalendars = "available_calendars"
    }
}

public struct GuidanceProposalReview: Equatable, Sendable {
    public let proposalId: String
    public let presentation: AgentProposalPresentation
}

public enum GuidanceProposalResponse: Decodable, Equatable, Sendable {
    case proposal(GuidanceProposalReview)
    case needsInformation([CreationQuestion], String)

    private enum CodingKeys: String, CodingKey {
        case status, proposal, questions, explanation
        case proposalId = "proposal_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .status) {
        case "proposal":
            let proposalId = try container.decode(String.self, forKey: .proposalId)
            let payload = try container.decode(GuidanceProposalPayload.self, forKey: .proposal)
            self = .proposal(GuidanceProposalReview(proposalId: proposalId, presentation: payload.presentation(reviewId: proposalId)))
        case "needs_information":
            let questions = try container.decode([GuidanceQuestionPayload].self, forKey: .questions)
            let explanation = try container.decode(String.self, forKey: .explanation)
            self = .needsInformation(questions.map(\.presentation), explanation)
        default:
            throw DecodingError.dataCorruptedError(forKey: .status, in: container, debugDescription: "Unsupported proposal status")
        }
    }
}

private struct GuidanceQuestionPayload: Decodable, Equatable, Sendable {
    struct Choice: Decodable, Equatable, Sendable {
        let label: String
        let value: String
    }
    let id: String
    let question: String
    let control: String
    let serviceName: String?
    let required: Bool
    let choices: [Choice]?

    enum CodingKeys: String, CodingKey {
        case id, question, control, required, choices
        case serviceName = "service_name"
    }

    var presentation: CreationQuestion {
        CreationQuestion(
            id: id,
            prompt: question,
            kind: kind,
            isRequired: required,
            choiceValues: choices?.map(\.value) ?? []
        )
    }

    private var kind: CreationQuestion.Kind {
        switch control {
        case "path": return .folder
        case "schedule": return .schedule
        case "permission": return .confirmation
        case "single_choice": return .choice(choices?.map(\.label) ?? [])
        case "service": return .service(name: serviceName, choices: choices?.map(\.label) ?? [])
        default: return .text
        }
    }
}

private struct GuidanceProposalPayload: Decodable, Equatable, Sendable {
    struct Trigger: Decodable, Equatable, Sendable {
        let humanDescription: String
        enum CodingKeys: String, CodingKey { case humanDescription = "human_description" }
    }

    struct Requirement: Decodable, Equatable, Sendable {
        let name: String
        let status: String
        let required: Bool

        var presentation: ConnectionPresentation {
            let state: ConnectionPresentation.State
            switch status {
            case "connected", "ready": state = .connected
            case "unavailable": state = .unavailable
            case "optional": state = .optional
            default: state = required ? .needsSetup : .optional
            }
            return ConnectionPresentation(name: name, state: state, isRequired: required, reason: reason)
        }

        let reason: String
    }

    struct FileAccess: Decodable, Equatable, Sendable {
        let path: String
        let access: String
        var presentation: FileAccessPresentation {
            FileAccessPresentation(path: path, canEdit: access != "read_only")
        }
    }

    struct CalendarAccess: Decodable, Equatable, Sendable {
        let id: String
        let name: String
        let access: String

        var presentation: CalendarAccessPresentation {
            CalendarAccessPresentation(id: id, name: name, canEdit: access == "read_write")
        }
    }

    struct Permissions: Decodable, Equatable, Sendable {
        let canModifyFiles: Bool
        let canRunCommands: Bool
        let requiresNetwork: Bool
        let canUseConnectedApps: Bool
        let canSendMessages: Bool

        enum CodingKeys: String, CodingKey {
            case canModifyFiles = "can_modify_files"
            case canRunCommands = "can_run_commands"
            case requiresNetwork = "requires_network"
            case canUseConnectedApps = "can_use_connected_apps"
            case canSendMessages = "can_send_messages"
        }

        var summaries: [String] {
            var values: [String] = []
            if canModifyFiles { values.append("Update selected files") }
            if canRunCommands { values.append("Run commands") }
            if requiresNetwork { values.append("Use the internet") }
            if canUseConnectedApps { values.append("Use connected apps") }
            if canSendMessages { values.append("Send messages") }
            return values
        }
    }

    let name: String
    let explanation: String
    let trigger: Trigger
    let connections: [Requirement]
    let fileAccess: [FileAccess]
    let calendarAccess: [CalendarAccess]?
    let permissions: Permissions
    let risk: SecurityRiskPayload
    let markdownInstructions: String

    enum CodingKeys: String, CodingKey {
        case name, explanation, trigger, connections, permissions, risk
        case fileAccess = "file_access"
        case calendarAccess = "calendar_access"
        case markdownInstructions = "markdown_instructions"
    }

    func presentation(reviewId: String) -> AgentProposalPresentation {
        var permissionSummaries = permissions.summaries
        if !fileAccess.isEmpty { permissionSummaries.insert("Read selected files", at: 0) }
        return AgentProposalPresentation(
            reviewId: reviewId,
            name: name,
            explanation: explanation,
            schedule: trigger.humanDescription,
            permissions: permissionSummaries,
            fileAccess: fileAccess.map(\.presentation),
            calendarAccess: (calendarAccess ?? []).map(\.presentation),
            connections: connections.map(\.presentation),
            instructions: markdownInstructions,
            risk: risk.consumerLevel,
            riskReason: risk.reasons.joined(separator: " ")
        )
    }
}

public struct GuidanceSaveRequest: Encodable, Equatable, Sendable {
    public let confirmed: Bool
    public init(confirmed: Bool = true) { self.confirmed = confirmed }
}

public struct GuidanceSaveResponse: Decodable, Equatable, Sendable {
    public struct SavedAgent: Decodable, Equatable, Sendable {
        public let id: String
        public let name: String
    }

    public let saved: Bool
    public let agent: SavedAgent
}
