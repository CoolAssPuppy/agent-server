import Foundation

struct Run: Codable, Identifiable {
    var id: String { runId }

    let runId: String
    let agentId: String
    let agentName: String
    let status: RunStatus
    let startedAt: Date
    let completedAt: Date?
    let summary: String?
    let error: String?
    let turnCount: Int
    let toolsUsed: [String]
    let filesRead: [String]
    let filesWritten: [String]
    let commandsRun: [String]
    let progressMessages: [String]

    let trigger: String?
    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let estimatedCostUsd: Double?
    let durationMs: Int?

    var isActive: Bool {
        status == .running
    }

    var elapsed: TimeInterval? {
        guard status == .running else { return nil }
        return Date().timeIntervalSince(startedAt)
    }

    var duration: TimeInterval? {
        if let durationMs {
            return TimeInterval(durationMs) / 1000.0
        }
        guard let completedAt else { return elapsed }
        return completedAt.timeIntervalSince(startedAt)
    }

    var totalTokens: Int? {
        guard let inputTokens, let outputTokens else { return nil }
        return inputTokens + outputTokens
    }
}

enum RunStatus: String, Codable {
    case running
    case completed
    case failed
    case skipped
}

struct HealthResponse: Codable {
    let status: String
    let timestamp: String
    let startedAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case timestamp
        case startedAt = "started_at"
    }
}

struct CleanupResponse: Codable {
    let ok: Bool
    let cleaned: Int
}

struct TriggerResponse: Codable {
    let runId: String
    let agentId: String
}
