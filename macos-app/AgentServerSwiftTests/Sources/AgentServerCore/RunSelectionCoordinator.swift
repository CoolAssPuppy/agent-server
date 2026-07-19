import Foundation

public struct RunSelectionRequest: Equatable, Sendable {
    public let runId: String
    fileprivate let revision: Int
}

public struct RunSelectionCoordinator: Equatable, Sendable {
    private var revision = 0
    private var selectedRunId: String?

    public init() {}

    public mutating func select(_ runId: String?) -> RunSelectionRequest? {
        revision += 1
        selectedRunId = runId
        guard let runId else { return nil }
        return RunSelectionRequest(runId: runId, revision: revision)
    }

    public func accepts(_ request: RunSelectionRequest) -> Bool {
        request.runId == selectedRunId && request.revision == revision
    }
}

public struct RunOutcomeCandidate: Equatable, Sendable {
    public let id: String
    public let startedAt: Date
    public let status: String
    public let code: String?

    public init(id: String, startedAt: Date, status: String, code: String?) {
        self.id = id
        self.startedAt = startedAt
        self.status = status
        self.code = code
    }
}

public enum RunOutcomeSelection {
    public static func latestMeaningfulRun(
        in candidates: [RunOutcomeCandidate]
    ) -> RunOutcomeCandidate? {
        candidates
            .filter(isMeaningfulOutcome)
            .max { $0.startedAt < $1.startedAt }
    }

    private static func isMeaningfulOutcome(_ candidate: RunOutcomeCandidate) -> Bool {
        guard candidate.status != "running" else { return false }
        return candidate.status != "skipped" || candidate.code != "lock_contention"
    }
}
