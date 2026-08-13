import Foundation

/// What an agent needs from a person before its automatic runs go ahead.
///
/// The server owns the verdict (`AutomaticRunVerdict`); this is the consumer
/// reading of it, combined with whether the person has already reviewed this
/// version of the agent.
public enum SecurityApprovalState: Equatable, Sendable {
    /// Nothing was found that a person has to accept.
    case notRequired
    /// Findings are waiting for a person to accept them.
    case awaitingApproval
    /// A person accepted this version of the agent.
    case approved(Date?)
    /// The risks themselves have to be resolved. An approval will not clear it.
    case blocked

    public init(
        risk: ConsumerRiskLevel,
        isStale: Bool,
        isReviewed: Bool,
        reviewedAt: Date?,
        automaticRuns: AutomaticRunVerdict?
    ) {
        if automaticRuns == .blocked {
            self = .blocked
        } else if risk == .low, !isStale, automaticRuns != .reviewRequired {
            self = .notRequired
        } else if isReviewed, !isStale {
            self = .approved(reviewedAt)
        } else {
            self = .awaitingApproval
        }
    }

    public var reviewedAt: Date? {
        guard case .approved(let date) = self else { return nil }
        return date
    }
}

public enum SecurityAgentGroup: String, CaseIterable, Equatable, Sendable {
    case needsApproval
    case approved
    case clean
    case notChecked

    public var title: String {
        switch self {
        case .needsApproval: "Needs approval"
        case .approved: "Approved"
        case .clean: "Clean"
        case .notChecked: "Not checked"
        }
    }
}

public struct SecurityAgentSection: Identifiable, Equatable, Sendable {
    public let group: SecurityAgentGroup
    public let agents: [SecurityAgentPresentation]

    public var id: String { group.rawValue }
    public var title: String { group.title }

    public init(group: SecurityAgentGroup, agents: [SecurityAgentPresentation]) {
        self.group = group
        self.agents = agents
    }
}

public struct SecurityGroupCount: Identifiable, Equatable, Sendable {
    public let group: SecurityAgentGroup
    public let count: Int

    public var id: String { group.rawValue }
    public var title: String { group.title }

    public init(group: SecurityAgentGroup, count: Int) {
        self.group = group
        self.count = count
    }
}

public struct SecurityDashboardSummary: Equatable, Sendable {
    /// Below this many agents, a search field costs more attention than it saves.
    public static let searchThreshold = 6

    public let counts: [SecurityGroupCount]
    public let headline: String
    public let detail: String
    public let totalCount: Int

    public var needsApprovalCount: Int { count(for: .needsApproval) }

    public var showsSearch: Bool { totalCount > Self.searchThreshold }

    public func count(for group: SecurityAgentGroup) -> Int {
        counts.first { $0.group == group }?.count ?? 0
    }
}

public struct SecurityApprovalQueue: Equatable, Sendable {
    public let agentIds: [String]

    public init(agentIds: [String]) {
        self.agentIds = agentIds
    }

    public init(dashboard: SecurityDashboardPresentation?) {
        self.agentIds = (dashboard?.agents ?? [])
            .filter { $0.group == .needsApproval }
            .map(\.id)
    }

    public var count: Int { agentIds.count }

    /// The next agent still waiting on a person. An agent that already left the
    /// backlog hands over to whatever is at the front of it.
    public func next(after agentId: String) -> String? {
        guard let index = agentIds.firstIndex(of: agentId) else {
            return agentIds.first { $0 != agentId }
        }
        let following = agentIds.index(after: index)
        return agentIds.indices.contains(following) ? agentIds[following] : nil
    }

    public func remaining(after agentId: String) -> Int {
        guard let index = agentIds.firstIndex(of: agentId) else {
            return agentIds.count { $0 != agentId }
        }
        return agentIds.count - index - 1
    }

    public func approveActionTitle(after agentId: String) -> String {
        next(after: agentId) == nil ? "Approve automatic runs" : "Approve and go to the next agent"
    }
}

public extension SecurityAgentPresentation {
    var group: SecurityAgentGroup {
        switch result {
        case .failed, .pending:
            return .notChecked
        case .checked(let risk, _, let isStale):
            switch approval {
            case .awaitingApproval, .blocked:
                return .needsApproval
            case .approved:
                return isStale ? .needsApproval : .approved
            case .notRequired:
                return risk == .low && !isStale ? .clean : .needsApproval
            }
        }
    }

    /// One row, one status. The group heading already says what state the agent
    /// is in, so only rows that say something the heading does not carry a
    /// status of their own.
    func securityRow(isSelected: Bool) -> SecurityRowPresentation {
        switch group {
        case .needsApproval:
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: findingCountLabel,
                status: isStale ? "Changed since review" : (risk?.title ?? ""),
                severity: risk,
                isSelected: isSelected
            )
        case .approved, .clean:
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: "",
                status: "",
                severity: nil,
                isSelected: isSelected
            )
        case .notChecked:
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: notCheckedDetail,
                status: isFailed ? "Could not check" : "Waiting",
                severity: nil,
                isSelected: isSelected
            )
        }
    }

    private var isFailed: Bool {
        if case .failed = result { return true }
        return false
    }

    private var notCheckedDetail: String {
        if case .failed(let message) = result { return message ?? "" }
        return ""
    }

    private var findingCountLabel: String {
        switch findingCount {
        case 0: ""
        case 1: "1 thing to review"
        default: "\(findingCount) things to review"
        }
    }
}

public extension SecurityDashboardPresentation {
    func sections(matching query: String = "") -> [SecurityAgentSection] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = trimmed.isEmpty
            ? agents
            : agents.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
        return SecurityAgentGroup.allCases.compactMap { group in
            let members = matches.filter { $0.group == group }
            return members.isEmpty ? nil : SecurityAgentSection(group: group, agents: members)
        }
    }

    var summary: SecurityDashboardSummary {
        let counts = SecurityAgentGroup.allCases.compactMap { group -> SecurityGroupCount? in
            let count = agents.count { $0.group == group }
            return count == 0 ? nil : SecurityGroupCount(group: group, count: count)
        }
        let waiting = counts.first { $0.group == .needsApproval }?.count ?? 0
        return SecurityDashboardSummary(
            counts: counts,
            headline: Self.headline(waiting: waiting, totalCount: agents.count),
            detail: summaryDetail,
            totalCount: agents.count
        )
    }

    private static func headline(waiting: Int, totalCount: Int) -> String {
        guard totalCount > 0 else { return "No agents to check yet" }
        switch waiting {
        case 0: return "Nothing needs your approval"
        case 1: return "1 agent needs your approval"
        default: return "\(waiting) agents need your approval"
        }
    }

    private var summaryDetail: String {
        guard !agents.isEmpty else { return "" }
        var parts = ["\(checkedCount) \(checkedCount == 1 ? "agent" : "agents") checked"]
        if failedCount > 0 { parts.append("\(failedCount) could not be checked") }
        if pendingCount > 0 { parts.append("\(pendingCount) waiting") }
        return parts.joined(separator: ", ")
    }
}
