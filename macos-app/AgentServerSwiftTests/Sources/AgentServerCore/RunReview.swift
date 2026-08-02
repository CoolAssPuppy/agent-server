import Foundation

/// A consumer-facing account of one local assistant run.
public struct RunReview: Decodable, Equatable, Sendable {
    public let outcome: RunReviewOutcome
    public let headline: PresentationStatement
    public let summary: PresentationStatement
    public let accomplishments: [PresentationStatement]
    public let changes: [PresentationStatement]
    public let outputs: [PresentationStatement]
    public let problems: [PresentationStatement]
    public let suggestions: [PresentationStatement]
    public let timeline: [HumanTimelineEntry]
    public let operationalCompleteness: OperationalCompleteness
    let waiting: RunReviewWaiting?
    public let technicalDetailsReference: String

    enum CodingKeys: String, CodingKey {
        case outcome, headline, summary, accomplishments, changes, outputs, problems
        case suggestions, timeline, operationalCompleteness, waiting, technicalDetailsReference
    }

    init(
        outcome: RunReviewOutcome,
        headline: PresentationStatement,
        summary: PresentationStatement,
        accomplishments: [PresentationStatement],
        changes: [PresentationStatement],
        outputs: [PresentationStatement],
        problems: [PresentationStatement],
        suggestions: [PresentationStatement],
        timeline: [HumanTimelineEntry],
        operationalCompleteness: OperationalCompleteness,
        waiting: RunReviewWaiting? = nil,
        technicalDetailsReference: String
    ) {
        self.outcome = outcome
        self.headline = headline
        self.summary = summary
        self.accomplishments = accomplishments
        self.changes = changes
        self.outputs = outputs
        self.problems = problems
        self.suggestions = suggestions
        self.timeline = timeline
        self.operationalCompleteness = operationalCompleteness
        self.waiting = waiting
        self.technicalDetailsReference = technicalDetailsReference
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        outcome = try container.decode(RunReviewOutcome.self, forKey: .outcome)
        headline = try container.decode(PresentationStatement.self, forKey: .headline)
        summary = try container.decode(PresentationStatement.self, forKey: .summary)
        accomplishments = try container.decode([PresentationStatement].self, forKey: .accomplishments)
        changes = try container.decode([PresentationStatement].self, forKey: .changes)
        outputs = try container.decode([PresentationStatement].self, forKey: .outputs)
        problems = try container.decode([PresentationStatement].self, forKey: .problems)
        suggestions = try container.decode([PresentationStatement].self, forKey: .suggestions)
        timeline = try container.decode([HumanTimelineEntry].self, forKey: .timeline)
        operationalCompleteness = try container.decode(
            OperationalCompleteness.self,
            forKey: .operationalCompleteness
        )
        waiting = try container.decodeIfPresent(RunReviewWaiting.self, forKey: .waiting)
        technicalDetailsReference = try container.decode(
            String.self,
            forKey: .technicalDetailsReference
        )
    }
}

struct RunReviewWaiting: Decodable, Equatable, Sendable {
    let waitingFor: PresentationStatement
    let reason: PresentationStatement
    let userAction: PresentationAction?
    let expiresAt: Date?

    private enum CodingKeys: String, CodingKey {
        case waitingFor, reason, userAction, expiresAt
    }

    init(
        waitingFor: PresentationStatement,
        reason: PresentationStatement,
        userAction: PresentationAction?,
        expiresAt: Date?
    ) {
        self.waitingFor = waitingFor
        self.reason = reason
        self.userAction = userAction
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        waitingFor = try container.decode(PresentationStatement.self, forKey: .waitingFor)
        reason = try container.decode(PresentationStatement.self, forKey: .reason)
        userAction = try container.decodeIfPresent(PresentationAction.self, forKey: .userAction)
        guard let value = try container.decodeIfPresent(String.self, forKey: .expiresAt) else {
            expiresAt = nil
            return
        }
        guard let date = RunReviewDateParser.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: .expiresAt,
                in: container,
                debugDescription: "Expected an ISO 8601 date."
            )
        }
        expiresAt = date
    }
}

private enum RunReviewDateParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

/// The user-visible result of a run.
public enum RunReviewOutcome: String, Decodable, Equatable, Sendable {
    case succeeded
    case partial
    case failed
    case canceled
    case skipped
    case working
    case waiting
    case unknown
}

/// Consumer copy paired with the local evidence that supports it.
public struct PresentationStatement: Decodable, Equatable, Sendable {
    public let text: String
    public let evidenceReferences: [String]
}

/// A meaningful step in an assistant run.
public struct HumanTimelineEntry: Decodable, Equatable, Sendable {
    public let kind: HumanTimelineEntryKind
    public let label: PresentationStatement
    public let occurredAt: String?
}

/// The stable vocabulary used by the human timeline.
public enum HumanTimelineEntryKind: String, Decodable, Equatable, Sendable {
    case started
    case connected
    case read
    case changed
    case produced
    case waiting
    case resumed
    case problem
    case finished
}

/// Whether deterministic output requirements were met.
public enum OperationalCompleteness: String, Decodable, Equatable, Sendable {
    case complete
    case incomplete
    case notAssessed = "not_assessed"
}
