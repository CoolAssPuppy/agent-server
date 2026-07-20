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

    public var readiness: AgentProposalReadiness {
        AgentProposalReadiness(connections: connections)
    }

    public var summary: AgentProposalSummary {
        AgentProposalSummary(
            name: name,
            outcome: explanation,
            schedule: schedule,
            requiredSetupNames: readiness.requiredSetupNames,
            risk: risk,
            riskReason: riskReason
        )
    }

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

public struct AgentProposalSummary: Equatable, Sendable {
    public let name: String
    public let outcome: String
    public let schedule: String
    public let requiredSetupNames: [String]
    public let risk: ConsumerRiskLevel
    public let riskReason: String
}

public enum AgentProposalReviewSurfaceStyle: Equatable, Sendable {
    case flatSections
}

public enum AgentProposalReviewTextRole: Equatable, Sendable {
    case sectionTitle
    case body
    case secondary
}

public struct AgentProposalReviewPolicy: Equatable, Sendable {
    public let surfaceStyle: AgentProposalReviewSurfaceStyle
    public let usesNestedCards: Bool
    public let consumerTextRoles: [AgentProposalReviewTextRole]

    public init(
        surfaceStyle: AgentProposalReviewSurfaceStyle = .flatSections,
        usesNestedCards: Bool = false,
        consumerTextRoles: [AgentProposalReviewTextRole] = [.sectionTitle, .body, .secondary]
    ) {
        self.surfaceStyle = surfaceStyle
        self.usesNestedCards = usesNestedCards
        self.consumerTextRoles = consumerTextRoles
    }
}

public enum AgentProposalReviewSection: Hashable, Sendable {
    case summary
    case connections
    case files
    case calendars
    case reminders
    case contacts
    case permissions
    case instructions
}

public extension AgentProposalPresentation {
    var reviewPolicy: AgentProposalReviewPolicy { AgentProposalReviewPolicy() }

    var reviewSections: [AgentProposalReviewSection] {
        var sections: [AgentProposalReviewSection] = [.summary]
        if !connections.isEmpty { sections.append(.connections) }
        if !fileAccess.isEmpty { sections.append(.files) }
        if !calendarAccess.isEmpty { sections.append(.calendars) }
        if !reminderAccess.isEmpty { sections.append(.reminders) }
        if !contactAccess.isEmpty { sections.append(.contacts) }
        sections.append(contentsOf: [.permissions, .instructions])
        return sections
    }
}

public struct AgentProposalReadiness: Equatable, Sendable {
    public let requiredSetupNames: [String]

    public init(connections: [ConnectionPresentation]) {
        requiredSetupNames = connections
            .filter { $0.isRequired && $0.state != .connected }
            .map(\.name)
    }

    public var canSave: Bool { requiredSetupNames.isEmpty }

    public var primaryActionTitle: String {
        requiredSetupNames.count == 1
            ? "Set up \(requiredSetupNames[0])"
            : "Set up required connections"
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
    public let rerunSafety: DiagnosticRerunSafety

    public var hasEvidence: Bool { !evidence.isEmpty }

    public init(
        title: String,
        explanation: String,
        evidence: [String],
        recommendedFix: ConfigurationFixPresentation?,
        preventionTip: String?,
        technicalDetails: String,
        rerunSafety: DiagnosticRerunSafety = .confirm
    ) {
        self.title = title
        self.explanation = explanation
        self.evidence = evidence
        self.recommendedFix = recommendedFix
        self.preventionTip = preventionTip
        self.technicalDetails = technicalDetails
        self.rerunSafety = rerunSafety
    }
}

public enum DiagnosticRerunSafety: String, Codable, Equatable, Sendable {
    case safe
    case confirm
    case unsafe
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

public enum SecurityAgentResult: Equatable, Sendable {
    case checked(risk: ConsumerRiskLevel, findingCount: Int, isStale: Bool)
    case failed(message: String?)
    case pending
}

public struct SecurityAgentPresentation: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let result: SecurityAgentResult

    public init(id: String, name: String, risk: ConsumerRiskLevel, findingCount: Int, isStale: Bool) {
        self.id = id
        self.name = name
        self.result = .checked(risk: risk, findingCount: findingCount, isStale: isStale)
    }

    public init(id: String, name: String, result: SecurityAgentResult) {
        self.id = id
        self.name = name
        self.result = result
    }

    public var risk: ConsumerRiskLevel? {
        guard case .checked(let risk, _, _) = result else { return nil }
        return risk
    }

    public var findingCount: Int {
        guard case .checked(_, let findingCount, _) = result else { return 0 }
        return findingCount
    }

    public var isStale: Bool {
        guard case .checked(_, _, let isStale) = result else { return false }
        return isStale
    }
}

public struct SecurityDashboardPresentation: Equatable, Sendable {
    public let agents: [SecurityAgentPresentation]
    private let reportedNeedsReviewCount: Int?

    public init(agents: [SecurityAgentPresentation], reportedNeedsReviewCount: Int? = nil) {
        self.agents = agents
        self.reportedNeedsReviewCount = reportedNeedsReviewCount
    }

    public init(
        scanAgents: [SecurityScanAgent],
        checkedAgents: [SecurityAgentPresentation],
        reportedNeedsReviewCount: Int? = nil
    ) {
        let checkedById = Dictionary(uniqueKeysWithValues: checkedAgents.map { ($0.id, $0) })
        self.agents = scanAgents.map { agent in
            switch agent.status {
            case .checked:
                return checkedById[agent.id]
                    ?? SecurityAgentPresentation(id: agent.id, name: agent.name, result: .pending)
            case .failed:
                return SecurityAgentPresentation(
                    id: agent.id,
                    name: agent.name,
                    result: .failed(message: agent.failureMessage)
                )
            case .pending, .analyzing:
                return SecurityAgentPresentation(id: agent.id, name: agent.name, result: .pending)
            }
        }
        self.reportedNeedsReviewCount = reportedNeedsReviewCount
    }

    public func agentCount(for risk: ConsumerRiskLevel) -> Int {
        agents.count { $0.risk == risk }
    }

    public var checkedCount: Int {
        agents.count {
            if case .checked = $0.result { return true }
            return false
        }
    }

    public var failedCount: Int {
        agents.count {
            if case .failed = $0.result { return true }
            return false
        }
    }

    public var pendingCount: Int {
        agents.count { $0.result == .pending }
    }

    public var needsReviewCount: Int {
        reportedNeedsReviewCount ?? agents.count(where: \.isStale)
    }

    public var notificationAttentionCount: Int {
        agents.count { $0.risk == .high || $0.risk == .critical }
    }
}
