import Foundation

public enum HTTPRequestMethod: String, Equatable, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
}

public enum SecurityServerRoute: Equatable, Sendable {
    case agent(String)
    case scan
    case review(String)

    public var method: HTTPRequestMethod {
        switch self {
        case .agent: return .get
        case .scan, .review: return .post
        }
    }

    public var timeoutInterval: TimeInterval {
        switch self {
        case .agent, .scan: return 15
        case .review: return 5
        }
    }

    public var path: String {
        switch self {
        case .agent(let id): return "/security/agents/\(Self.pathSegment(id))"
        case .scan: return "/security/scan"
        case .review(let id): return "/security/agents/\(Self.pathSegment(id))/review"
        }
    }

    private static func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}

public struct SecurityRiskPayload: Decodable, Equatable, Sendable {
    public let level: String
    public let reasons: [String]
    public let findingCount: Int

    enum CodingKeys: String, CodingKey {
        case level, reasons
        case findingCount = "finding_count"
    }

    public var consumerLevel: ConsumerRiskLevel {
        switch level {
        case "needs_review": return .needsReview
        case "high": return .high
        case "critical": return .critical
        default: return .low
        }
    }
}

public struct SecurityRecommendedActionPayload: Decodable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let description: String
    public let kind: String
    public let risk: String
    public let requiresConfirmation: Bool
    public let affectsFunctionality: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, description, kind, risk
        case requiresConfirmation = "requires_confirmation"
        case affectsFunctionality = "affects_functionality"
    }
}

public struct SecurityFindingPayload: Decodable, Equatable, Sendable {
    public let id: String
    public let ruleId: String
    public let severity: String
    public let title: String
    public let explanation: String
    public let potentialImpact: String
    public let trigger: String
    public let recommendation: SecurityRecommendedActionPayload
    public let canIgnore: Bool
    public let modelGenerated: Bool
    public let confidence: Double
    public let patch: GuidanceConfigurationPatch?

    enum CodingKeys: String, CodingKey {
        case id, severity, title, explanation, trigger, recommendation, confidence, patch
        case ruleId = "rule_id"
        case potentialImpact = "potential_impact"
        case canIgnore = "can_ignore"
        case modelGenerated = "model_generated"
    }

    public var presentation: SecurityFindingPresentation {
        SecurityFindingPresentation(
            id: id,
            severity: SecurityRiskPayload(level: severity, reasons: [], findingCount: 0).consumerLevel,
            title: title,
            whyItMatters: explanation,
            potentialImpact: potentialImpact,
            trigger: trigger,
            recommendation: recommendation.label,
            functionalityImpact: recommendation.affectsFunctionality
                ? "This change may limit part of the agent's current task."
                : "This change should not affect the agent's intended task.",
            canFix: patch != nil
        )
    }
}

public struct SecurityAnalysisPayload: Decodable, Equatable, Sendable {
    public struct ReviewState: Decodable, Equatable, Sendable {
        public let reviewedAt: String?
        public let isReviewed: Bool
        public let isStale: Bool
        public let acknowledgedFindingIds: [String]

        enum CodingKeys: String, CodingKey {
            case reviewedAt = "reviewed_at"
            case isReviewed = "is_reviewed"
            case isStale = "is_stale"
            case acknowledgedFindingIds = "acknowledged_finding_ids"
        }

        public var reviewedDate: Date? {
            guard let reviewedAt else { return nil }
            return ISO8601DateFormatter().date(from: reviewedAt)
        }
    }

    public let schemaVersion: Int
    public let agentId: String
    public let contentHash: String
    public let analyzerVersion: String
    public let analyzedAt: String
    public let risk: SecurityRiskPayload
    public let findings: [SecurityFindingPayload]
    public let isStale: Bool
    public let modelStatus: String
    public let reviewState: ReviewState?

    enum CodingKeys: String, CodingKey {
        case findings, risk
        case schemaVersion = "schema_version"
        case agentId = "agent_id"
        case contentHash = "content_hash"
        case analyzerVersion = "analyzer_version"
        case analyzedAt = "analyzed_at"
        case isStale = "is_stale"
        case modelStatus = "model_status"
        case reviewState = "review_state"
    }

    public var presentation: SecurityScanPresentation {
        SecurityScanPresentation(
            findings: findings.map(\.presentation),
            reviewedAt: reviewState?.reviewedDate,
            isStale: reviewState?.isStale ?? isStale
        )
    }
}

public struct SecurityScanPayload: Decodable, Equatable, Sendable {
    public struct Summary: Decodable, Equatable, Sendable {
        public let totalAgents: Int
        public let byRisk: [String: Int]
        public let staleReviews: Int

        enum CodingKeys: String, CodingKey {
            case totalAgents = "total_agents"
            case byRisk = "by_risk"
            case staleReviews = "stale_reviews"
        }
    }

    public let analyses: [SecurityAnalysisPayload]
    public let summary: Summary

    public func presentation(agentNames: [String: String]) -> SecurityDashboardPresentation {
        SecurityDashboardPresentation(agents: analyses.map { analysis in
            SecurityAgentPresentation(
                id: analysis.agentId,
                name: agentNames[analysis.agentId] ?? analysis.agentId,
                risk: analysis.risk.consumerLevel,
                findingCount: analysis.findings.count,
                isStale: analysis.reviewState?.isStale ?? analysis.isStale
            )
        }, reportedNeedsReviewCount: summary.staleReviews)
    }
}

public struct SecurityReviewResponse: Decodable, Equatable, Sendable {
    public let reviewed: Bool
    public let reviewState: SecurityAnalysisPayload.ReviewState?

    enum CodingKeys: String, CodingKey {
        case reviewed
        case reviewState = "review_state"
    }
}

public struct SecurityReviewRequestPayload: Encodable, Equatable, Sendable {
    public let contentHash: String
    public let acknowledgedFindingIds: [String]

    public init(contentHash: String, acknowledgedFindingIds: [String]) {
        self.contentHash = contentHash
        self.acknowledgedFindingIds = acknowledgedFindingIds
    }

    enum CodingKeys: String, CodingKey {
        case contentHash = "content_hash"
        case acknowledgedFindingIds = "acknowledged_finding_ids"
    }
}

public struct SecurityAcknowledgementState: Equatable, Sendable {
    private struct Record: Equatable, Sendable {
        let contentHash: String
        var findingIds: Set<String>
    }

    private var records: [String: Record] = [:]

    public init() {}

    public mutating func acknowledge(agentId: String, contentHash: String, findingId: String) {
        guard records[agentId]?.contentHash == contentHash else {
            records[agentId] = Record(contentHash: contentHash, findingIds: [findingId])
            return
        }
        records[agentId]?.findingIds.insert(findingId)
    }

    public mutating func findingIds(agentId: String, contentHash: String) -> Set<String> {
        guard records[agentId]?.contentHash == contentHash else {
            records[agentId] = nil
            return []
        }
        return records[agentId]?.findingIds ?? []
    }
}
