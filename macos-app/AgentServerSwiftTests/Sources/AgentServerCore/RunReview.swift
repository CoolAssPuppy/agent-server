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
    public let technicalDetailsReference: String
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
