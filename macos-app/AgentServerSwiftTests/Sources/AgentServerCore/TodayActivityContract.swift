import Foundation

struct ContractTodayPresentation: Decodable, Equatable, Sendable {
    let sections: [ContractTodaySection]
    let allClear: PresentationStatement?
}

struct ContractTodaySection: Decodable, Equatable, Sendable {
    let kind: ContractTodaySectionKind
    let items: [ContractTodayItem]
}

struct ContractTodayItem: Decodable, Equatable, Sendable {
    let id: String
    let section: ContractTodaySectionKind
    let assistant: AssistantPresentationIdentity
    let headline: PresentationStatement
    let explanation: PresentationStatement
    let occurredAt: Date?
    let scheduledAt: Date?
    let expiresAt: Date?
    let primaryAction: PresentationAction
    let secondaryDisclosure: PresentationAction?
    let sourceReferences: [String]

    private enum CodingKeys: String, CodingKey {
        case id, section, assistant, headline, explanation
        case occurredAt, scheduledAt, expiresAt
        case primaryAction, secondaryDisclosure, sourceReferences
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        section = try container.decode(ContractTodaySectionKind.self, forKey: .section)
        assistant = try container.decode(AssistantPresentationIdentity.self, forKey: .assistant)
        headline = try container.decode(PresentationStatement.self, forKey: .headline)
        explanation = try container.decode(PresentationStatement.self, forKey: .explanation)
        occurredAt = try container.decodePresentationDateIfPresent(forKey: .occurredAt)
        scheduledAt = try container.decodePresentationDateIfPresent(forKey: .scheduledAt)
        expiresAt = try container.decodePresentationDateIfPresent(forKey: .expiresAt)
        primaryAction = try container.decode(PresentationAction.self, forKey: .primaryAction)
        secondaryDisclosure = try container.decodeIfPresent(
            PresentationAction.self,
            forKey: .secondaryDisclosure
        )
        sourceReferences = try container.decode([String].self, forKey: .sourceReferences)
    }
}

struct ContractActivityPresentation: Decodable, Equatable, Sendable {
    let items: [ContractActivityItem]
}

struct ContractActivityItem: Decodable, Equatable, Sendable {
    let id: String
    let assistant: AssistantPresentationIdentity
    let conversationId: String?
    let state: ContractActivityState
    let headline: PresentationStatement
    let outcomeSummary: PresentationStatement?
    let startedAt: Date
    let endedAt: Date?
    let primaryOutput: PresentationStatement?
    let reviewReference: String
    let sourceReferences: [String]

    private enum CodingKeys: String, CodingKey {
        case id, assistant, conversationId, state, headline, outcomeSummary
        case startedAt, endedAt, primaryOutput, reviewReference, sourceReferences
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        assistant = try container.decode(AssistantPresentationIdentity.self, forKey: .assistant)
        conversationId = try container.decodeIfPresent(String.self, forKey: .conversationId)
        state = try container.decode(ContractActivityState.self, forKey: .state)
        headline = try container.decode(PresentationStatement.self, forKey: .headline)
        outcomeSummary = try container.decodeIfPresent(
            PresentationStatement.self,
            forKey: .outcomeSummary
        )
        startedAt = try container.decodePresentationDate(forKey: .startedAt)
        endedAt = try container.decodePresentationDateIfPresent(forKey: .endedAt)
        primaryOutput = try container.decodeIfPresent(
            PresentationStatement.self,
            forKey: .primaryOutput
        )
        reviewReference = try container.decode(String.self, forKey: .reviewReference)
        sourceReferences = try container.decode([String].self, forKey: .sourceReferences)
    }
}

struct AssistantPresentationIdentity: Decodable, Equatable, Sendable {
    let installationId: String
    let machineId: String
    let localAgentId: String
    let displayName: String
}

struct PresentationAction: Decodable, Equatable, Sendable {
    let kind: PresentationActionKind
    let label: String
    let targetReference: String
}

enum PresentationActionKind: Equatable, Sendable {
    case respond, viewActivity, review, viewAssistant, unknown
}

extension PresentationActionKind: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "respond": .respond
        case "view_activity": .viewActivity
        case "review": .review
        case "view_assistant": .viewAssistant
        default: .unknown
        }
    }
}

enum ContractTodaySectionKind: Equatable, Sendable {
    case needsYou, working, finished, problems, upcoming, unknown

    var presentationSection: TodaySection? {
        switch self {
        case .needsYou: .needsYou
        case .working: .working
        case .finished: .finished
        case .problems: .problems
        case .upcoming: .upcoming
        case .unknown: nil
        }
    }
}

extension ContractTodaySectionKind: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "needs_you": .needsYou
        case "working": .working
        case "finished": .finished
        case "problems": .problems
        case "upcoming": .upcoming
        default: .unknown
        }
    }
}

enum ContractActivityState: Equatable, Sendable {
    case needsYou, working, finished, problem, unknown

    var presentationState: ActivityState? {
        switch self {
        case .needsYou: .needsYou
        case .working: .working
        case .finished: .finished
        case .problem: .problem
        case .unknown: nil
        }
    }
}

extension ContractActivityState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "needs_you": .needsYou
        case "working": .working
        case "finished": .finished
        case "problem": .problem
        default: .unknown
        }
    }
}

private enum PresentationISO8601DateParser {
    static func date(from value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: value) { return date }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

private extension KeyedDecodingContainer {
    func decodePresentationDate(forKey key: Key) throws -> Date {
        let value = try decode(String.self, forKey: key)
        guard let date = PresentationISO8601DateParser.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected an ISO 8601 date."
            )
        }
        return date
    }

    func decodePresentationDateIfPresent(forKey key: Key) throws -> Date? {
        guard let value = try decodeIfPresent(String.self, forKey: key) else { return nil }
        guard let date = PresentationISO8601DateParser.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected an ISO 8601 date."
            )
        }
        return date
    }
}
