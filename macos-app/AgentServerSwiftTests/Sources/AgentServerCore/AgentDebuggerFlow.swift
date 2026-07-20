import Foundation

public enum AgentDebuggerSurfaceStyle: Equatable, Sendable {
    case flatSections
}

public enum AgentDebuggerSection: Equatable, Sendable {
    case problem
    case evidence
    case recommendedFix
    case actions
}

public enum AgentDebuggerPresentation {
    public static let surfaceStyle = AgentDebuggerSurfaceStyle.flatSections
    public static let sections: [AgentDebuggerSection] = [.problem, .evidence, .recommendedFix, .actions]
    public static let disclosesTechnicalDetails = true
}

public struct AgentDebuggerFlow: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case idle
        case diagnosing
        case diagnosis
        case fixReview
        case applying
        case readyToRetry
        case retrying
        case resolved
        case failed
    }

    public private(set) var phase: Phase
    public let failedRunId: String?
    public private(set) var retryRunId: String?
    public private(set) var diagnosis: DiagnosticPresentation?
    public private(set) var failure: ConsumerFlowFailure?

    public init(failedRunId: String? = nil) {
        self.phase = .idle
        self.failedRunId = failedRunId
    }

    public var canApplyFix: Bool {
        phase == .fixReview && diagnosis?.recommendedFix?.canApply == true
    }

    public mutating func beginDiagnosis() {
        phase = .diagnosing
        failure = nil
    }

    public mutating func receiveDiagnosis(_ diagnosis: DiagnosticPresentation) {
        self.diagnosis = diagnosis
        phase = .diagnosis
    }

    public mutating func reviewRecommendedFix() {
        guard diagnosis?.recommendedFix?.canApply == true else { return }
        phase = .fixReview
    }

    public mutating func cancelFixReview() { phase = .diagnosis }

    public mutating func beginApply() {
        guard canApplyFix else { return }
        phase = .applying
    }

    public mutating func didApplyFix() {
        guard phase == .applying else { return }
        phase = .readyToRetry
    }

    public mutating func beginRetry() {
        guard phase == .readyToRetry || phase == .diagnosis else { return }
        phase = .retrying
    }

    public mutating func didStartRetry(runId: String) {
        guard phase == .retrying else { return }
        retryRunId = runId
    }

    public mutating func resolve() {
        guard phase == .retrying else { return }
        phase = .resolved
    }

    public mutating func updateRetry(runId: String, state: SafeTestRunState) {
        guard phase == .retrying, runId == retryRunId else { return }
        switch state {
        case .running:
            break
        case .completed:
            resolve()
        case .failed(let details):
            fail(.init(
                title: "The retry still needs attention",
                message: "The new run did not finish successfully. The original failed run is still preserved.",
                recovery: "Open the new run, or diagnose the problem again.",
                technicalDetails: details,
                didSave: false,
                canRetry: true
            ))
        case .stopped:
            phase = .readyToRetry
        }
    }

    public mutating func fail(_ failure: ConsumerFlowFailure) {
        self.failure = failure
        phase = .failed
    }
}
