import Foundation

struct PanelRunsResponse: Decodable {
    let runs: [PanelRun]
}

struct PanelRun: Decodable, Identifiable {
    let id: String
    let taskId: String
    let taskName: String
    let status: String
    let trigger: String?
    let queuedAt: Date?
    let startedAt: Date?
    let endedAt: Date?
    let durationMs: Int?
    let errorMessage: String?
    let result: PanelRunResult?
    let conversationId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case taskName = "task_name"
        case status, trigger, result
        case queuedAt = "queued_at"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case durationMs = "duration_ms"
        case errorMessage = "error_message"
        case conversationId = "conversation_id"
    }

    func toRun(agentId: String) -> Run {
        let mappedStatus: RunStatus = switch status {
        case "completed": .completed
        case "failed", "canceled": .failed
        default: .running
        }

        let output = result?.output
        let usage = result?.usage

        return Run(
            runId: id,
            agentId: agentId,
            agentName: taskName,
            status: mappedStatus,
            startedAt: startedAt ?? queuedAt ?? Date(),
            completedAt: endedAt,
            summary: result?.summary,
            error: errorMessage,
            turnCount: usage?.turns ?? output?.turnCount ?? 0,
            toolsUsed: output?.toolsUsed ?? [],
            filesRead: output?.filesRead ?? [],
            filesWritten: output?.filesWritten ?? [],
            commandsRun: output?.commandsRun ?? [],
            progressMessages: [],
            accomplishments: result?.accomplishments ?? [],
            observations: result?.observations ?? [],
            trigger: trigger,
            model: result?.model,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            estimatedCostUsd: usage?.estimatedCostUsd,
            durationMs: durationMs,
            conversationId: conversationId
        )
    }
}

struct PanelRunResult: Decodable {
    let summary: String?
    let accomplishments: [String]?
    let observations: [String]?
    let usage: PanelRunUsage?
    let output: PanelRunOutput?
    let model: String?
}

struct PanelRunUsage: Decodable {
    let inputTokens: Int?
    let outputTokens: Int?
    let totalTokens: Int?
    let estimatedCostUsd: Double?
    let turns: Int?
    let filesRead: Int?
    let filesWritten: Int?
    let commandsRun: Int?

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case totalTokens = "total_tokens"
        case estimatedCostUsd = "estimated_cost_usd"
        case turns
        case filesRead = "files_read"
        case filesWritten = "files_written"
        case commandsRun = "commands_run"
    }
}

// MARK: - Logs

struct PanelLogsResponse: Decodable {
    let logs: [PanelLog]
}

struct PanelLog: Decodable, Identifiable {
    let id: Int
    let timestamp: Date
    let level: String
    let message: String
    let metadata: [String: PanelLogValue]?

    var isHeartbeat: Bool {
        message == "heartbeat"
    }

    var turnsCompleted: Int? {
        guard let meta = metadata,
              case .int(let turns) = meta["turns_completed"] else { return nil }
        return turns
    }
}

enum PanelLogValue: Decodable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let val = try? container.decode(Int.self) { self = .int(val) }
        else if let val = try? container.decode(Double.self) { self = .double(val) }
        else if let val = try? container.decode(Bool.self) { self = .bool(val) }
        else if let val = try? container.decode(String.self) { self = .string(val) }
        else if container.decodeNil() { self = .null }
        else { self = .null }
    }
}

// MARK: - Run output

struct PanelRunOutput: Decodable {
    let turnCount: Int?
    let toolsUsed: [String]?
    let filesRead: [String]?
    let filesWritten: [String]?
    let commandsRun: [String]?

    enum CodingKeys: String, CodingKey {
        case turnCount = "turn_count"
        case toolsUsed = "tools_used"
        case filesRead = "files_read"
        case filesWritten = "files_written"
        case commandsRun = "commands_run"
    }
}
