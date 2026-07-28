import Foundation

enum AgentTriggerPresentationKind: Equatable {
    case scheduled
    case watcher
    case onDemand
}

struct AgentTriggerPresentation: Equatable {
    let kind: AgentTriggerPresentationKind
    let fallbackLabel: String?

    init(schedule: String?, hasWatch: Bool) {
        if schedule != nil {
            self.kind = .scheduled
            self.fallbackLabel = nil
        } else if hasWatch {
            self.kind = .watcher
            self.fallbackLabel = "File watch"
        } else {
            self.kind = .onDemand
            self.fallbackLabel = "On demand"
        }
    }
}

enum AgentCatalogPresentation {
    static func availableAgentIds(
        agentIds: [String],
        runningAgentIds: Set<String>
    ) -> Set<String> {
        Set(agentIds).subtracting(runningAgentIds)
    }
}

enum AgentRunTriggerFailure: Equatable {
    case offline
    case takingLonger
    case missingConnection
    case securityReview
    case securityBlocked
    case generic

    /// Snake-case slug for analytics. Spelled out rather than derived from the
    /// case name so renaming a case does not silently rename an event property
    /// that dashboards are already grouping by.
    var analyticsReason: String {
        switch self {
        case .offline: return "offline"
        case .takingLonger: return "taking_longer"
        case .missingConnection: return "missing_connection"
        case .securityReview: return "security_review"
        case .securityBlocked: return "security_blocked"
        case .generic: return "generic"
        }
    }

    static func classify(
        serverCode: String?,
        serverMessage: String? = nil,
        hasMissingConnection: Bool = false,
        isTransportFailure: Bool = false,
        isRequestTimeout: Bool = false
    ) -> Self {
        if hasMissingConnection { return .missingConnection }

        switch serverCode {
        case "missing_connection", "missing_environment":
            return .missingConnection
        case "blocked":
            return .securityBlocked
        case "review_required", "confirmation_required", "content_changed":
            return .securityReview
        default:
            break
        }

        if serverMessage?.localizedCaseInsensitiveContains("security check") == true {
            return .securityReview
        }
        if isRequestTimeout { return .takingLonger }
        if isTransportFailure { return .offline }
        return .generic
    }
}

enum AgentRunTriggerRecovery: Equatable {
    case retry
    case openAgentSettings
    case reviewSecurity
    case openRun
    case checkStatus
}

struct AgentRunTriggerFeedback: Equatable {
    let title: String
    let message: String
    let recoveryTitle: String
    let recovery: AgentRunTriggerRecovery
}

enum AgentRunControlActionStyle: Equatable {
    case borderedProminent
}

enum AgentRunControlStatusStyle: Equatable {
    case secondaryText
}

enum AgentRunControlFeedbackStyle: Equatable {
    case flat
}

struct AgentRunControlSupportingSurfacePresentation: Equatable {
    let primaryActionStyle = AgentRunControlActionStyle.borderedProminent
    let pausedStatusStyle = AgentRunControlStatusStyle.secondaryText
    let feedbackStyle = AgentRunControlFeedbackStyle.flat
    let isFeedbackSelectable = true
    let supportsReducedMotion = true
}

enum AgentRunTriggerState: Equatable {
    case idle
    case starting
    case started(runId: String)
    case failure(AgentRunTriggerFailure)

    var isStarting: Bool {
        self == .starting
    }

    var startedRunId: String? {
        guard case .started(let runId) = self else { return nil }
        return runId
    }

    var presentation: AgentRunTriggerFeedback? {
        switch self {
        case .idle, .starting:
            return nil
        case .started:
            return AgentRunTriggerFeedback(
                title: "Run started",
                message: "You can follow its progress in run history.",
                recoveryTitle: "Open run",
                recovery: .openRun
            )
        case .failure(.offline):
            return AgentRunTriggerFeedback(
                title: "Agent Server is offline",
                message: "Nothing was run. Start Agent Server, then try again.",
                recoveryTitle: "Try again",
                recovery: .retry
            )
        case .failure(.takingLonger):
            return AgentRunTriggerFeedback(
                title: "The safety check is taking longer",
                message: "The server may still start this run. Check its status before trying again.",
                recoveryTitle: "Check status",
                recovery: .checkStatus
            )
        case .failure(.missingConnection):
            return AgentRunTriggerFeedback(
                title: "Connect an app or service",
                message: "Nothing was run. This agent needs a connection before it can start.",
                recoveryTitle: "Open agent settings",
                recovery: .openAgentSettings
            )
        case .failure(.securityReview):
            return AgentRunTriggerFeedback(
                title: "Review security before running",
                message: "Nothing was run. Review the security check, then try again.",
                recoveryTitle: "Review security",
                recovery: .reviewSecurity
            )
        case .failure(.securityBlocked):
            return AgentRunTriggerFeedback(
                title: "This agent needs a safer setup",
                message: "Nothing was run. Security check found a critical issue that must be reviewed.",
                recoveryTitle: "Review security",
                recovery: .reviewSecurity
            )
        case .failure(.generic):
            return AgentRunTriggerFeedback(
                title: "Run could not start",
                message: "Nothing was run. Try again, or review the agent's settings.",
                recoveryTitle: "Try again",
                recovery: .retry
            )
        }
    }
}

struct AgentRunCandidate: Equatable, Sendable {
    let runId: String
    let agentId: String
    let startedAt: Date
}

enum AgentRunReconciliation {
    static func matchedRunId(
        agentId: String,
        requestedAt: Date,
        candidates: [AgentRunCandidate]
    ) -> String? {
        candidates
            .filter { $0.agentId == agentId && $0.startedAt >= requestedAt }
            .max { $0.startedAt < $1.startedAt }?
            .runId
    }
}
