import Foundation

/// Semantic color intent for a run review without coupling presentation logic to SwiftUI.
public enum RunReviewPresentationTone: Equatable, Sendable {
    case positive
    case caution
    case negative
    case neutral
}

/// Stable consumer sections shown beneath a run summary.
public enum RunReviewSectionKind: Equatable, Sendable {
    case outputs
    case changes
    case problems
    case suggestions

    public var title: String {
        switch self {
        case .outputs: "Outputs"
        case .changes: "Changes"
        case .problems: "Problems"
        case .suggestions: "Suggestions"
        }
    }
}

/// One nonempty, evidence-preserving section in a run review.
public struct RunReviewPresentationSection: Equatable, Sendable {
    public let kind: RunReviewSectionKind
    public let statements: [PresentationStatement]

    public var title: String { kind.title }
}

/// UI-ready values derived from the shared run review contract.
public struct RunReviewPresentation: Equatable, Sendable {
    public let outcomeLabel: String
    public let tone: RunReviewPresentationTone
    public let symbolName: String
    public let sections: [RunReviewPresentationSection]
    public let isTechnicalDetailsAvailable: Bool

    public init(review: RunReview) {
        let outcome = Self.outcomePresentation(for: review.outcome)
        outcomeLabel = outcome.label
        tone = outcome.tone
        symbolName = outcome.symbolName
        sections = Self.consumerSections(for: review)
        isTechnicalDetailsAvailable = !review.technicalDetailsReference
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    private static func outcomePresentation(
        for outcome: RunReviewOutcome
    ) -> (label: String, tone: RunReviewPresentationTone, symbolName: String) {
        switch outcome {
        case .succeeded: ("Finished", .positive, "checkmark.circle.fill")
        case .partial: ("Finished with problems", .caution, "exclamationmark.triangle.fill")
        case .failed: ("Needs attention", .negative, "xmark.circle.fill")
        case .canceled: ("Canceled", .neutral, "xmark.circle")
        case .skipped: ("Did not run", .neutral, "forward.end.circle")
        case .working: ("Working", .caution, "bolt.circle.fill")
        case .waiting: ("Waiting for a response", .caution, "hourglass")
        case .unknown: ("Status unavailable", .neutral, "questionmark.circle")
        }
    }

    private static func consumerSections(for review: RunReview) -> [RunReviewPresentationSection] {
        [
            RunReviewPresentationSection(kind: .outputs, statements: review.outputs),
            RunReviewPresentationSection(kind: .changes, statements: review.changes),
            RunReviewPresentationSection(kind: .problems, statements: review.problems),
            RunReviewPresentationSection(kind: .suggestions, statements: review.suggestions),
        ].filter { !$0.statements.isEmpty }
    }
}
