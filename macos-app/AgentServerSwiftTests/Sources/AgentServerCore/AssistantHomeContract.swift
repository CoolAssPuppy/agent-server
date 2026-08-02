import Foundation

struct AssistantHomeContract: Decodable, Equatable, Sendable {
    let generatedAt: Date?
    let assistant: AssistantPresentationIdentity
    let purpose: PresentationStatement
    let health: AssistantHealth
    let readiness: AssistantReadiness
    let schedule: AssistantSchedule
    let permissions: [AssistantPermissionStatement]
    let connections: [AssistantConnection]
    let destination: PresentationStatement?
    let recentOutcomes: [AssistantRecentOutcome]
    let attention: AssistantAttention?
    let advanced: AssistantHomeAdvanced?
    let primaryAction: PresentationAction
    let secondaryActions: [PresentationAction]
    let advancedReference: String

    private enum CodingKeys: String, CodingKey {
        case generatedAt, assistant, purpose, health, readiness, schedule, permissions
        case connections, destination, recentOutcomes, attention, primaryAction
        case secondaryActions, advanced, advancedReference
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decodeAssistantHomeDateIfPresent(forKey: .generatedAt)
        assistant = try container.decode(AssistantPresentationIdentity.self, forKey: .assistant)
        purpose = try container.decode(PresentationStatement.self, forKey: .purpose)
        health = try container.decode(AssistantHealth.self, forKey: .health)
        readiness = try container.decode(AssistantReadiness.self, forKey: .readiness)
        schedule = try container.decode(AssistantSchedule.self, forKey: .schedule)
        permissions = try container.decode([AssistantPermissionStatement].self, forKey: .permissions)
        connections = try container.decode([AssistantConnection].self, forKey: .connections)
        destination = try container.decodeIfPresent(PresentationStatement.self, forKey: .destination)
        recentOutcomes = try container.decode([AssistantRecentOutcome].self, forKey: .recentOutcomes)
        attention = try container.decodeIfPresent(AssistantAttention.self, forKey: .attention)
        advanced = try container.decodeIfPresent(AssistantHomeAdvanced.self, forKey: .advanced)
        primaryAction = try container.decode(PresentationAction.self, forKey: .primaryAction)
        secondaryActions = try container.decode([PresentationAction].self, forKey: .secondaryActions)
        advancedReference = try container.decode(String.self, forKey: .advancedReference)
    }
}

struct AssistantHomeAdvanced: Decodable, Equatable, Sendable {
    let scheduleExpression: String?
    let executor: String
    let model: String?
    let permissionMode: String?
    let permissionRules: AssistantAdvancedPermissionRules
    let connectionIds: [String]
}

struct AssistantAdvancedPermissionRules: Decodable, Equatable, Sendable {
    let allow: [String]
    let deny: [String]
}

struct AssistantHealth: Decodable, Equatable, Sendable {
    let state: AssistantHealthState
    let summary: PresentationStatement
    let reasonReferences: [String]
}

struct AssistantReadiness: Decodable, Equatable, Sendable {
    let state: AssistantReadinessState
    let summary: PresentationStatement
    let checks: [AssistantReadinessCheck]
}

struct AssistantReadinessCheck: Decodable, Equatable, Sendable {
    let kind: AssistantReadinessCheckKind
    let state: AssistantReadinessCheckState
    let explanation: PresentationStatement
    let action: PresentationAction?
    let evidenceSource: String
}

struct AssistantSchedule: Decodable, Equatable, Sendable {
    let kind: AssistantScheduleKind
    let summary: PresentationStatement
    let nextRunAt: Date?

    private enum CodingKeys: String, CodingKey {
        case kind, summary, nextRunAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(AssistantScheduleKind.self, forKey: .kind)
        summary = try container.decode(PresentationStatement.self, forKey: .summary)
        nextRunAt = try container.decodeAssistantHomeDateIfPresent(forKey: .nextRunAt)
    }
}

struct AssistantPermissionStatement: Decodable, Equatable, Sendable {
    let effect: AssistantPermissionEffect
    let action: AssistantPermissionAction
    let targetLabel: String
    let exactScopeReference: String
    let sourceRuleReference: String
}

struct AssistantConnection: Decodable, Equatable, Sendable {
    let id: String
    let label: String
    let state: AssistantConnectionState
    let explanation: PresentationStatement
}

struct AssistantRecentOutcome: Decodable, Equatable, Sendable {
    let runId: String
    let outcome: AssistantOutcomeState
    let headline: PresentationStatement
    let occurredAt: Date
    let reviewReference: String

    private enum CodingKeys: String, CodingKey {
        case runId, outcome, headline, occurredAt, reviewReference
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        runId = try container.decode(String.self, forKey: .runId)
        outcome = try container.decode(AssistantOutcomeState.self, forKey: .outcome)
        headline = try container.decode(PresentationStatement.self, forKey: .headline)
        occurredAt = try container.decodeAssistantHomeDate(forKey: .occurredAt)
        reviewReference = try container.decode(String.self, forKey: .reviewReference)
    }
}

struct AssistantAttention: Decodable, Equatable, Sendable {
    let summary: PresentationStatement
    let action: PresentationAction
    let expiresAt: Date?

    private enum CodingKeys: String, CodingKey {
        case summary, action, expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        summary = try container.decode(PresentationStatement.self, forKey: .summary)
        action = try container.decode(PresentationAction.self, forKey: .action)
        expiresAt = try container.decodeAssistantHomeDateIfPresent(forKey: .expiresAt)
    }
}

private enum AssistantHomeDateParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}

private extension KeyedDecodingContainer {
    func decodeAssistantHomeDate(forKey key: Key) throws -> Date {
        let value = try decode(String.self, forKey: key)
        guard let date = AssistantHomeDateParser.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected an ISO 8601 date."
            )
        }
        return date
    }

    func decodeAssistantHomeDateIfPresent(forKey key: Key) throws -> Date? {
        guard let value = try decodeIfPresent(String.self, forKey: key) else { return nil }
        guard let date = AssistantHomeDateParser.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected an ISO 8601 date."
            )
        }
        return date
    }
}
