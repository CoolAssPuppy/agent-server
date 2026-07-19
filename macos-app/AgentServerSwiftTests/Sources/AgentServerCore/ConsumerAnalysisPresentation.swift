import Foundation

public enum ConsumerRiskLevel: String, Codable, CaseIterable, Sendable {
    case low
    case needsReview
    case high
    case critical

    public var title: String {
        switch self {
        case .low: return "Low risk"
        case .needsReview: return "Needs review"
        case .high: return "High risk"
        case .critical: return "Critical"
        }
    }

    public var rank: Int {
        switch self {
        case .low: return 0
        case .needsReview: return 1
        case .high: return 2
        case .critical: return 3
        }
    }
}

public struct ConnectionPresentation: Equatable, Sendable {
    public enum State: String, Sendable {
        case connected
        case needsSetup
        case optional
        case unavailable

        public var title: String {
            switch self {
            case .connected: return "Connected"
            case .needsSetup: return "Needs setup"
            case .optional: return "Optional"
            case .unavailable: return "Unavailable"
            }
        }
    }

    public let name: String
    public let state: State
    public let isRequired: Bool
    public let reason: String

    public init(name: String, state: State, isRequired: Bool = false, reason: String = "") {
        self.name = name
        self.state = state
        self.isRequired = isRequired
        self.reason = reason
    }
}

public struct FileAccessPresentation: Equatable, Sendable {
    public let path: String
    public let canEdit: Bool

    public init(path: String, canEdit: Bool) {
        self.path = path
        self.canEdit = canEdit
    }
}

public struct CalendarAccessPresentation: Equatable, Sendable {
    public let id: String
    public let name: String
    public let account: String?
    public let canEdit: Bool

    public init(id: String, name: String, account: String? = nil, canEdit: Bool) {
        self.id = id
        self.name = name
        self.account = account
        self.canEdit = canEdit
    }
}

public struct ReminderAccessPresentation: Equatable, Sendable {
    public let id: String
    public let name: String
    public let account: String?
    public let actions: [String]

    public init(id: String, name: String, account: String? = nil, actions: [String]) {
        self.id = id
        self.name = name
        self.account = account
        self.actions = actions
    }
}

public struct ContactAccessPresentation: Equatable, Sendable {
    public let id: String
    public let name: String
    public let account: String?
    public let details: [String]

    public init(id: String, name: String, account: String? = nil, details: [String]) {
        self.id = id
        self.name = name
        self.account = account
        self.details = details
    }
}

public struct AgentProposalPresentation: Equatable, Sendable {
    public let reviewId: String?
    public let name: String
    public let explanation: String
    public let schedule: String
    public let permissions: [String]
    public let fileAccess: [FileAccessPresentation]
    public let calendarAccess: [CalendarAccessPresentation]
    public let reminderAccess: [ReminderAccessPresentation]
    public let contactAccess: [ContactAccessPresentation]
    public let connections: [ConnectionPresentation]
    public let instructions: String
    public let risk: ConsumerRiskLevel
    public let riskReason: String

    public init(
        reviewId: String? = nil,
        name: String,
        explanation: String,
        schedule: String,
        permissions: [String],
        fileAccess: [FileAccessPresentation],
        calendarAccess: [CalendarAccessPresentation] = [],
        reminderAccess: [ReminderAccessPresentation] = [],
        contactAccess: [ContactAccessPresentation] = [],
        connections: [ConnectionPresentation],
        instructions: String,
        risk: ConsumerRiskLevel,
        riskReason: String
    ) {
        self.reviewId = reviewId
        self.name = name
        self.explanation = explanation
        self.schedule = schedule
        self.permissions = permissions
        self.fileAccess = fileAccess
        self.calendarAccess = calendarAccess
        self.reminderAccess = reminderAccess
        self.contactAccess = contactAccess
        self.connections = connections
        self.instructions = instructions
        self.risk = risk
        self.riskReason = riskReason
    }
}

public struct ConfigurationFixPresentation: Equatable, Sendable {
    public let title: String
    public let impact: String
    public let risk: ConsumerRiskLevel
    public let changes: [String]
    public let technicalDiff: String
    public let canApply: Bool

    public init(
        title: String,
        impact: String,
        risk: ConsumerRiskLevel,
        changes: [String],
        technicalDiff: String,
        canApply: Bool = true
    ) {
        self.title = title
        self.impact = impact
        self.risk = risk
        self.changes = changes
        self.technicalDiff = technicalDiff
        self.canApply = canApply
    }
}

public struct DiagnosticPresentation: Equatable, Sendable {
    public let title: String
    public let explanation: String
    public let evidence: [String]
    public let recommendedFix: ConfigurationFixPresentation?
    public let preventionTip: String?
    public let technicalDetails: String

    public init(
        title: String,
        explanation: String,
        evidence: [String],
        recommendedFix: ConfigurationFixPresentation?,
        preventionTip: String?,
        technicalDetails: String
    ) {
        self.title = title
        self.explanation = explanation
        self.evidence = evidence
        self.recommendedFix = recommendedFix
        self.preventionTip = preventionTip
        self.technicalDetails = technicalDetails
    }
}

public struct SecurityFindingPresentation: Identifiable, Equatable, Sendable {
    public let id: String
    public let severity: ConsumerRiskLevel
    public let title: String
    public let whyItMatters: String
    public let potentialImpact: String
    public let trigger: String
    public let recommendation: String
    public let functionalityImpact: String
    public let canFix: Bool

    public init(
        id: String,
        severity: ConsumerRiskLevel,
        title: String,
        whyItMatters: String,
        potentialImpact: String,
        trigger: String,
        recommendation: String,
        functionalityImpact: String,
        canFix: Bool
    ) {
        self.id = id
        self.severity = severity
        self.title = title
        self.whyItMatters = whyItMatters
        self.potentialImpact = potentialImpact
        self.trigger = trigger
        self.recommendation = recommendation
        self.functionalityImpact = functionalityImpact
        self.canFix = canFix
    }
}

public struct SecurityFindingGroup: Equatable, Sendable {
    public let severity: ConsumerRiskLevel
    public let findings: [SecurityFindingPresentation]
    public var title: String { severity.title }
}

public struct SecurityScanPresentation: Equatable, Sendable {
    public let findings: [SecurityFindingPresentation]
    public let reviewedAt: Date?
    public let isStale: Bool

    public init(findings: [SecurityFindingPresentation], reviewedAt: Date?, isStale: Bool) {
        self.findings = findings
        self.reviewedAt = reviewedAt
        self.isStale = isStale
    }

    public var overallRisk: ConsumerRiskLevel {
        findings.max(by: { $0.severity.rank < $1.severity.rank })?.severity ?? .low
    }

    public var summaryText: String {
        guard !findings.isEmpty else { return "Security check found no issues." }
        let noun = findings.count == 1 ? "thing" : "things"
        return "Security check found \(findings.count) \(noun) to review."
    }

    public var groupedFindings: [SecurityFindingGroup] {
        ConsumerRiskLevel.allCases.reversed().compactMap { severity in
            let matches = findings.filter { $0.severity == severity }
            return matches.isEmpty ? nil : SecurityFindingGroup(severity: severity, findings: matches)
        }
    }
}

public struct SecurityAgentPresentation: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let risk: ConsumerRiskLevel
    public let findingCount: Int
    public let isStale: Bool

    public init(id: String, name: String, risk: ConsumerRiskLevel, findingCount: Int, isStale: Bool) {
        self.id = id
        self.name = name
        self.risk = risk
        self.findingCount = findingCount
        self.isStale = isStale
    }
}

public struct SecurityDashboardPresentation: Equatable, Sendable {
    public let agents: [SecurityAgentPresentation]
    private let reportedNeedsReviewCount: Int?

    public init(agents: [SecurityAgentPresentation], reportedNeedsReviewCount: Int? = nil) {
        self.agents = agents
        self.reportedNeedsReviewCount = reportedNeedsReviewCount
    }

    public func agentCount(for risk: ConsumerRiskLevel) -> Int {
        agents.count { $0.risk == risk }
    }

    public var needsReviewCount: Int {
        reportedNeedsReviewCount ?? agents.count(where: \.isStale)
    }

    public var notificationAttentionCount: Int {
        agents.count { $0.risk == .high || $0.risk == .critical }
    }
}
