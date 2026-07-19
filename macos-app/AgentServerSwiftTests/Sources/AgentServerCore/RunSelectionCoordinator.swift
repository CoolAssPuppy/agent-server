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
