import Foundation
import SwiftUI
import AgentServerDesignSystem

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
    let code: String?
    let turnCount: Int
    let toolsUsed: [String]
    let filesRead: [String]
    let filesWritten: [String]
    let commandsRun: [String]
    let progressMessages: [String]
    let accomplishments: [String]
    let observations: [String]

    let trigger: String?
    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let estimatedCostUsd: Double?
    let durationMs: Int?
    let conversationId: String?
    let conversationChannel: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runId = try c.decode(String.self, forKey: .runId)
        agentId = try c.decode(String.self, forKey: .agentId)
        agentName = try c.decode(String.self, forKey: .agentName)
        status = try c.decode(RunStatus.self, forKey: .status)
        startedAt = try c.decode(Date.self, forKey: .startedAt)
        completedAt = try c.decodeIfPresent(Date.self, forKey: .completedAt)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        code = try c.decodeIfPresent(String.self, forKey: .code)
        turnCount = try c.decodeIfPresent(Int.self, forKey: .turnCount) ?? 0
        toolsUsed = try c.decodeIfPresent([String].self, forKey: .toolsUsed) ?? []
        filesRead = try c.decodeIfPresent([String].self, forKey: .filesRead) ?? []
        filesWritten = try c.decodeIfPresent([String].self, forKey: .filesWritten) ?? []
        commandsRun = try c.decodeIfPresent([String].self, forKey: .commandsRun) ?? []
        progressMessages = try c.decodeIfPresent([String].self, forKey: .progressMessages) ?? []
        accomplishments = try c.decodeIfPresent([String].self, forKey: .accomplishments) ?? []
        observations = try c.decodeIfPresent([String].self, forKey: .observations) ?? []
        trigger = try c.decodeIfPresent(String.self, forKey: .trigger)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens)
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens)
        estimatedCostUsd = try c.decodeIfPresent(Double.self, forKey: .estimatedCostUsd)
        durationMs = try c.decodeIfPresent(Int.self, forKey: .durationMs)
        conversationId = try c.decodeIfPresent(String.self, forKey: .conversationId)
        conversationChannel = try c.decodeIfPresent(String.self, forKey: .conversationChannel)
    }

    init(
        runId: String, agentId: String, agentName: String, status: RunStatus,
        startedAt: Date, completedAt: Date?, summary: String?, error: String?,
        code: String? = nil,
        turnCount: Int, toolsUsed: [String], filesRead: [String], filesWritten: [String],
        commandsRun: [String], progressMessages: [String],
        accomplishments: [String] = [], observations: [String] = [],
        trigger: String?, model: String?, inputTokens: Int?, outputTokens: Int?,
        estimatedCostUsd: Double?, durationMs: Int?, conversationId: String?,
        conversationChannel: String? = nil
    ) {
        self.runId = runId; self.agentId = agentId; self.agentName = agentName
        self.status = status; self.startedAt = startedAt; self.completedAt = completedAt
        self.summary = summary; self.error = error; self.code = code; self.turnCount = turnCount
        self.toolsUsed = toolsUsed; self.filesRead = filesRead; self.filesWritten = filesWritten
        self.commandsRun = commandsRun; self.progressMessages = progressMessages
        self.accomplishments = accomplishments; self.observations = observations
        self.trigger = trigger; self.model = model; self.inputTokens = inputTokens
        self.outputTokens = outputTokens; self.estimatedCostUsd = estimatedCostUsd
        self.durationMs = durationMs; self.conversationId = conversationId
        self.conversationChannel = conversationChannel
    }

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

    /// Theme-token color for this status, so status colors track the active
    /// theme instead of hardcoded system colors (the app is multi-theme).
    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .running: return tokens.warning
        case .completed: return tokens.success
        case .failed: return tokens.destructive
        case .skipped: return tokens.mutedForeground
        }
    }

    var displayLabel: String {
        switch self {
        case .running: "Running"
        case .completed: "Completed"
        case .failed: "Failed"
        case .skipped: "Skipped"
        }
    }
}

struct HealthResponse: Codable {
    let status: String
    let timestamp: String
    let startedAt: String?
    let apiVersion: Int?

    enum CodingKeys: String, CodingKey {
        case status
        case timestamp
        case startedAt = "started_at"
        case apiVersion = "api_version"
    }
}

struct MachineResponse: Codable {
    let machineId: String
    let protocolVersion: Int
    let serverVersion: String

    enum CodingKeys: String, CodingKey {
        case machineId = "machine_id"
        case protocolVersion = "protocol_version"
        case serverVersion = "server_version"
    }
}

struct CleanupResponse: Codable {
    let ok: Bool
    let cleaned: Int
}

struct PairingResponse: Codable {
    let ok: Bool
    /// What Panel will call this Mac in its device list.
    let displayName: String

    // The route answers `display_name`, like every other snake_case reply the
    // local API sends. Without this the credential is written, the machine is
    // paired, and the person is told the data could not be read.
    enum CodingKeys: String, CodingKey {
        case ok
        case displayName = "display_name"
    }
}

struct TriggerResponse: Codable {
    let runId: String
    let agentId: String
}
