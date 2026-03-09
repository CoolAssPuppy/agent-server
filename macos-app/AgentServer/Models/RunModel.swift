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
    let progressMessages: [String]

    var isActive: Bool {
        status == .running
    }

    var elapsed: TimeInterval? {
        guard status == .running else { return nil }
        return Date().timeIntervalSince(startedAt)
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
}

struct TriggerResponse: Codable {
    let runId: String
    let agentId: String
}
