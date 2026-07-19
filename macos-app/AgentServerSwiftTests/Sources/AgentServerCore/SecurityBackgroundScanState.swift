public enum SecurityBackgroundScanPhase: Equatable, Sendable {
    case idle
    case scanning
    case complete
    case failed
}

public enum SecurityScanAgentStatus: Equatable, Sendable {
    case pending
    case analyzing
    case checked(ConsumerRiskLevel)
    case failed

    public var displayLabel: String {
        switch self {
        case .pending: return "Waiting"
        case .analyzing: return "Checking"
        case .checked(let risk): return risk.title
        case .failed: return "Could not check"
        }
    }
}

public struct SecurityScanAgent: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let status: SecurityScanAgentStatus
    public let failureMessage: String?

    public init(
        id: String,
        name: String,
        status: SecurityScanAgentStatus = .pending,
        failureMessage: String? = nil
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.failureMessage = failureMessage
    }

    fileprivate func withStatus(
        _ status: SecurityScanAgentStatus,
        failureMessage: String? = nil
    ) -> Self {
        Self(id: id, name: name, status: status, failureMessage: failureMessage)
    }
}

public enum SecurityScanNotification: Equatable, Sendable {
    case none
    case attention(count: Int)
    case error
}

public struct SecurityBackgroundScanState: Equatable, Sendable {
    public let phase: SecurityBackgroundScanPhase
    public let agents: [SecurityScanAgent]
    public let failureMessage: String?
    public let attentionCount: Int

    public static let idle = Self(
        phase: .idle,
        agents: [],
        failureMessage: nil,
        attentionCount: 0
    )

    public static func scanning(agents: [SecurityScanAgent]) -> Self {
        guard !agents.isEmpty else {
            return Self(phase: .complete, agents: [], failureMessage: nil, attentionCount: 0)
        }
        var queued = agents.map { $0.withStatus(.pending) }
        queued[0] = queued[0].withStatus(.analyzing)
        return Self(phase: .scanning, agents: queued, failureMessage: nil, attentionCount: 0)
    }

    public var currentAgent: SecurityScanAgent? {
        agents.first { $0.status == .analyzing }
    }

    public var completedCount: Int {
        agents.count {
            if case .checked = $0.status { return true }
            return false
        }
    }

    public var processedCount: Int {
        agents.count {
            if case .checked = $0.status { return true }
            return $0.status == .failed
        }
    }

    public var notification: SecurityScanNotification {
        if phase == .failed { return .error }
        if attentionCount > 0 { return .attention(count: attentionCount) }
        return .none
    }

    public var accessibilitySummary: String {
        switch notification {
        case .none:
            return phase == .scanning
                ? "Security check in progress, \(processedCount) of \(agents.count) agents complete"
                : "Security check"
        case .error:
            return "Security check failed"
        case .attention(let count):
            let noun = count == 1 ? "agent" : "agents"
            return "Security check found \(count) \(noun) that need\(count == 1 ? "s" : "") attention"
        }
    }

    public func completingCurrentAgent(risk: ConsumerRiskLevel) -> Self {
        guard let currentIndex = agents.firstIndex(where: { $0.status == .analyzing }) else { return self }
        var updated = agents
        updated[currentIndex] = updated[currentIndex].withStatus(.checked(risk))
        let nextIndex = updated.index(after: currentIndex)
        if updated.indices.contains(nextIndex) {
            updated[nextIndex] = updated[nextIndex].withStatus(.analyzing)
            return Self(
                phase: .scanning,
                agents: updated,
                failureMessage: failureMessage,
                attentionCount: attentionCount
            )
        }
        let hasFailure = updated.contains { $0.status == .failed }
        return Self(
            phase: hasFailure ? .failed : .complete,
            agents: updated,
            failureMessage: failureMessage,
            attentionCount: attentionCount
        )
    }

    public func recordingCurrentFailure(message: String) -> Self {
        guard let currentIndex = agents.firstIndex(where: { $0.status == .analyzing }) else { return self }
        var updated = agents
        updated[currentIndex] = updated[currentIndex].withStatus(.failed, failureMessage: message)
        let nextIndex = updated.index(after: currentIndex)
        if updated.indices.contains(nextIndex) {
            updated[nextIndex] = updated[nextIndex].withStatus(.analyzing)
            return Self(
                phase: .scanning,
                agents: updated,
                failureMessage: failureMessage ?? message,
                attentionCount: attentionCount
            )
        }
        return Self(
            phase: .failed,
            agents: updated,
            failureMessage: failureMessage ?? message,
            attentionCount: attentionCount
        )
    }

    public func failing(message: String) -> Self {
        var updated = agents
        if let currentIndex = updated.firstIndex(where: { $0.status == .analyzing }) {
            updated[currentIndex] = updated[currentIndex].withStatus(.failed, failureMessage: message)
        }
        return Self(phase: .failed, agents: updated, failureMessage: message, attentionCount: attentionCount)
    }

    public func reportingAttention(count: Int) -> Self {
        Self(
            phase: phase,
            agents: agents,
            failureMessage: failureMessage,
            attentionCount: max(0, count)
        )
    }
}
