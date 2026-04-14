import Foundation

// MARK: - Decision

enum DecisionType: String, Codable, CaseIterable {
    case approve
    case pick
    case answer
}

enum DecisionStatus: String, Codable {
    case pending
    case resolved
    case expired
    case canceled
}

struct DecisionSource: Codable, Hashable {
    let title: String
    let url: String
    let kind: String?
}

struct DecisionPickOption: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let description: String?
}

struct DecisionPayload: Codable, Hashable {
    // Approve
    let approveLabel: String?
    let declineLabel: String?
    let recommendation: String?

    // Pick
    let options: [DecisionPickOption]?
    let allowNone: Bool?
    let recommendedOptionId: String?

    // Answer
    let prompt: String?
    let placeholder: String?
    let suggestedAnswer: String?
    let maxLength: Int?

    // Common
    let body: String?
    let reasoning: String?
    let confidence: Double?
    let sources: [DecisionSource]?

    enum CodingKeys: String, CodingKey {
        case approveLabel = "approve_label"
        case declineLabel = "decline_label"
        case recommendation
        case options
        case allowNone = "allow_none"
        case recommendedOptionId = "recommended_option_id"
        case prompt, placeholder
        case suggestedAnswer = "suggested_answer"
        case maxLength = "max_length"
        case body, reasoning, confidence, sources
    }
}

struct Decision: Codable, Identifiable, Hashable {
    let id: String
    let taskRunId: String
    let agentSlug: String
    let agentName: String?
    let type: DecisionType
    let title: String
    let payload: DecisionPayload
    let status: DecisionStatus
    let dueAt: Date?
    let deferUntil: Date?
    let createdAt: Date
    let resolvedAt: Date?
    let resolvedBy: String?
    let resolvedVia: String?
    let resolution: DecisionResolution?

    enum CodingKeys: String, CodingKey {
        case id
        case taskRunId = "task_run_id"
        case agentSlug = "agent_slug"
        case agentName = "agent_name"
        case type, title, payload, status
        case dueAt = "due_at"
        case deferUntil = "defer_until"
        case createdAt = "created_at"
        case resolvedAt = "resolved_at"
        case resolvedBy = "resolved_by"
        case resolvedVia = "resolved_via"
        case resolution
    }
}

// A resolution row persisted with the decision once it's answered.
struct DecisionResolution: Codable, Hashable {
    let type: String
    let approved: Bool?
    let optionId: String?
    let text: String?
    let notes: String?
    let deferUntil: Date?

    enum CodingKeys: String, CodingKey {
        case type, approved, notes
        case optionId = "option_id"
        case text
        case deferUntil = "defer_until"
    }
}

// MARK: - Resolve request bodies (Encodable only)

enum DecisionResolveBody: Encodable, Hashable {
    case approve(approved: Bool, notes: String?)
    case pick(optionId: String?, notes: String?)
    case answer(text: String, notes: String?)
    case defer_(until: Date)

    private enum CodingKeys: String, CodingKey {
        case type, approved, notes
        case optionId = "option_id"
        case text
        case deferUntil = "defer_until"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .approve(let approved, let notes):
            try c.encode("approve", forKey: .type)
            try c.encode(approved, forKey: .approved)
            try c.encodeIfPresent(notes, forKey: .notes)
        case .pick(let optionId, let notes):
            try c.encode("pick", forKey: .type)
            try c.encode(optionId, forKey: .optionId)
            try c.encodeIfPresent(notes, forKey: .notes)
        case .answer(let text, let notes):
            try c.encode("answer", forKey: .type)
            try c.encode(text, forKey: .text)
            try c.encodeIfPresent(notes, forKey: .notes)
        case .defer_(let until):
            try c.encode("defer", forKey: .type)
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try c.encode(iso.string(from: until), forKey: .deferUntil)
        }
    }
}

// MARK: - Response wrappers

struct DecisionsResponse: Decodable {
    let decisions: [Decision]
}

// MARK: - Convenience

extension Decision {
    var isPending: Bool {
        guard status == .pending else { return false }
        if let deferUntil, deferUntil > Date() { return false }
        return true
    }

    /// Human-readable "12m ago" style timestamp.
    var relativeCreatedAt: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: createdAt, relativeTo: Date())
    }

    var deepLinkURLString: String? {
        "https://panel.agent-server.app/decisions/\(id)"
    }
}

extension Array where Element == Decision {
    func pending() -> [Decision] { filter { $0.isPending } }

    func groupedByAgentSlug() -> [String: Int] {
        var counts: [String: Int] = [:]
        for d in self where d.isPending {
            counts[d.agentSlug, default: 0] += 1
        }
        return counts
    }
}
