import Foundation

public struct GuidanceDiagnosticPayload: Decodable, Equatable, Sendable {
    struct Evidence: Decodable, Equatable, Sendable {
        let label: String
        let detail: String
    }

    struct Action: Decodable, Equatable, Sendable {
        let label: String
        let description: String
        let risk: String
    }

    public let runId: String
    public let summary: String
    public let mostLikelyCause: String
    public let confidence: Double
    let evidence: [Evidence]
    let suggestedFix: Action?
    let affectedSettings: [String]
    public let risk: String
    public let canAutomate: Bool
    public let nextStep: String
    public let source: String
    public let resolution: GuidanceResolutionPayload?

    enum CodingKeys: String, CodingKey {
        case summary, confidence, evidence, risk, source, resolution
        case runId = "run_id"
        case mostLikelyCause = "most_likely_cause"
        case suggestedFix = "suggested_fix"
        case affectedSettings = "affected_settings"
        case canAutomate = "can_automate"
        case nextStep = "next_step"
    }

    public var validatedPatch: GuidanceConfigurationPatch? {
        guard case .configurationPatch(let patch, _, _, _) = resolution else { return nil }
        return patch
    }

    public var presentation: DiagnosticPresentation { presentation(with: nil) }

    public func presentation(with preview: GuidancePatchPreview?) -> DiagnosticPresentation {
        let hasApplicablePatch = validatedPatch != nil && preview?.canApply == true
        return DiagnosticPresentation(
            title: summary,
            explanation: mostLikelyCause,
            evidence: evidence.map { "\($0.label): \($0.detail)" },
            recommendedFix: suggestedFix.map { action in
                ConfigurationFixPresentation(
                    title: action.label,
                    impact: action.description,
                    risk: consumerRisk(preview?.risk ?? action.risk),
                    changes: preview?.changes.map(\.summary) ?? affectedSettings,
                    technicalDiff: preview?.advancedChanges.prettyPrinted ?? "",
                    canApply: hasApplicablePatch
                )
            },
            preventionTip: nextStep,
            technicalDetails: "Source: \(source)\nConfidence: \(Int(confidence * 100))%"
        )
    }

    private func consumerRisk(_ value: String) -> ConsumerRiskLevel {
        SecurityRiskPayload(level: value, reasons: [], findingCount: 0).consumerLevel
    }
}

public enum GuidanceResolutionPayload: Decodable, Equatable, Sendable {
    case configurationPatch(GuidanceConfigurationPatch, String, String, Bool)
    case other(type: String)

    private enum CodingKeys: String, CodingKey {
        case type, patch
        case previewEndpoint = "preview_endpoint"
        case applyEndpoint = "apply_endpoint"
        case confirmationRequired = "confirmation_required"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "configuration_patch" else {
            self = .other(type: type)
            return
        }
        self = .configurationPatch(
            try container.decode(GuidanceConfigurationPatch.self, forKey: .patch),
            try container.decode(String.self, forKey: .previewEndpoint),
            try container.decode(String.self, forKey: .applyEndpoint),
            try container.decode(Bool.self, forKey: .confirmationRequired)
        )
    }
}

public struct GuidanceConfigurationPatch: Codable, Equatable, Sendable {
    public struct Confirmation: Codable, Equatable, Sendable {
        public let approved: Bool
        public let previewContentHash: String
        enum CodingKeys: String, CodingKey {
            case approved
            case previewContentHash = "preview_content_hash"
        }
    }

    public let schemaVersion: Int
    public let agentId: String
    public let expectedContentHash: String
    public let source: String
    public let reason: String
    public let changes: GuidanceJSONValue
    public let confirmation: Confirmation?

    enum CodingKeys: String, CodingKey {
        case source, reason, changes, confirmation
        case schemaVersion = "schema_version"
        case agentId = "agent_id"
        case expectedContentHash = "expected_content_hash"
    }

    public func confirming(previewContentHash: String) -> Self {
        Self(
            schemaVersion: schemaVersion,
            agentId: agentId,
            expectedContentHash: expectedContentHash,
            source: source,
            reason: reason,
            changes: changes,
            confirmation: Confirmation(approved: true, previewContentHash: previewContentHash)
        )
    }
}

public struct GuidancePatchPreview: Decodable, Equatable, Sendable {
    public struct Change: Decodable, Equatable, Sendable {
        public let field: String
        public let summary: String

        public init(field: String, summary: String) {
            self.field = field
            self.summary = summary
        }
    }

    public let resultContentHash: String
    public let changes: [Change]
    public let advancedChanges: GuidanceJSONValue
    public let risk: String
    public let requiresConfirmation: Bool
    public let canApply: Bool

    public init(
        resultContentHash: String,
        changes: [Change],
        advancedChanges: GuidanceJSONValue,
        risk: String,
        requiresConfirmation: Bool,
        canApply: Bool
    ) {
        self.resultContentHash = resultContentHash
        self.changes = changes
        self.advancedChanges = advancedChanges
        self.risk = risk
        self.requiresConfirmation = requiresConfirmation
        self.canApply = canApply
    }

    enum CodingKeys: String, CodingKey {
        case changes, risk
        case resultContentHash = "result_content_hash"
        case advancedChanges = "advanced_changes"
        case requiresConfirmation = "requires_confirmation"
        case canApply = "can_apply"
    }
}

public struct GuidancePatchApplyResponse: Decodable, Equatable, Sendable {
    public let rollbackToken: String
    enum CodingKeys: String, CodingKey { case rollbackToken = "rollback_token" }
}

public struct GuidanceRetryRequest: Encodable, Equatable, Sendable {
    public let confirmed: Bool
    public init(confirmed: Bool = true) { self.confirmed = confirmed }
}

public struct GuidanceRetryResponse: Decodable, Equatable, Sendable {
    public let runId: String
    enum CodingKeys: String, CodingKey { case runId = "run_id" }
}

public enum GuidanceJSONValue: Codable, Equatable, Sendable {
    case object([String: Self])
    case array([Self])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([Self].self) { self = .array(value) }
        else { self = .object(try container.decode([String: Self].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var prettyPrinted: String {
        guard let data = try? JSONEncoder().encode(self),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else {
            return ""
        }
        return String(decoding: pretty, as: UTF8.self)
    }
}
