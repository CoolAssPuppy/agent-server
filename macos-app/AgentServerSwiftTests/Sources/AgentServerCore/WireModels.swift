import Foundation

/// The local API's wire models, decoded from the server's JSON.
///
/// These live in the core package rather than the app target so the contract
/// tests can decode the checked-in fixtures with the exact types the app
/// ships. Presentation helpers that need SwiftUI (status colors) stay in the
/// app as extensions.
public struct Run: Codable, Identifiable {
    public var id: String { runId }

    public let runId: String
    public let agentId: String
    public let agentName: String
    public let status: RunStatus
    public let startedAt: Date
    public let completedAt: Date?
    public let summary: String?
    public let error: String?
    public let code: String?
    public let turnCount: Int
    public let toolsUsed: [String]
    public let filesRead: [String]
    public let filesWritten: [String]
    public let commandsRun: [String]
    public let progressMessages: [String]
    public let accomplishments: [String]
    public let observations: [String]

    public let trigger: String?
    public let model: String?
    public let inputTokens: Int?
    public let outputTokens: Int?
    public let estimatedCostUsd: Double?
    public let durationMs: Int?
    public let conversationId: String?
    public let conversationChannel: String?

    public init(from decoder: Decoder) throws {
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

    public init(
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

    public var isActive: Bool {
        status == .running
    }

    public var elapsed: TimeInterval? {
        guard status == .running else { return nil }
        return Date().timeIntervalSince(startedAt)
    }

    public var duration: TimeInterval? {
        if let durationMs {
            return TimeInterval(durationMs) / 1000.0
        }
        guard let completedAt else { return elapsed }
        return completedAt.timeIntervalSince(startedAt)
    }

    public var totalTokens: Int? {
        guard let inputTokens, let outputTokens else { return nil }
        return inputTokens + outputTokens
    }
}

public enum RunStatus: String, Codable {
    case running
    case completed
    case failed
    case skipped

    public var displayLabel: String {
        switch self {
        case .running: "Running"
        case .completed: "Completed"
        case .failed: "Failed"
        case .skipped: "Skipped"
        }
    }
}

public struct HealthResponse: Codable {
    public let status: String
    public let timestamp: String
    public let startedAt: String?
    public let apiVersion: Int?
    /// The version of the server that answered, so the app can notice it is
    /// running a build older than itself. Absent before 3.7.6.
    public let serverVersion: String?
    /// Whether Panel is hearing from this Mac. Absent when no Panel is
    /// configured or the server predates 3.7.6.
    public let panel: PanelReportingStatus?

    enum CodingKeys: String, CodingKey {
        case status
        case timestamp
        case panel
        case startedAt = "started_at"
        case apiVersion = "api_version"
        case serverVersion = "server_version"
    }
}

public struct MachineResponse: Codable {
    public let machineId: String
    public let protocolVersion: Int
    public let serverVersion: String

    enum CodingKeys: String, CodingKey {
        case machineId = "machine_id"
        case protocolVersion = "protocol_version"
        case serverVersion = "server_version"
    }
}

public struct CleanupResponse: Codable {
    public let ok: Bool
    public let cleaned: Int
}

public struct PairingResponse: Codable {
    public let ok: Bool
    /// What Panel will call this Mac in its device list.
    public let displayName: String

    // The route answers `display_name`, like every other snake_case reply the
    // local API sends. Without this the credential is written, the machine is
    // paired, and the person is told the data could not be read.
    enum CodingKeys: String, CodingKey {
        case ok
        case displayName = "display_name"
    }
}

public struct TriggerResponse: Codable {
    public let runId: String
    public let agentId: String

    // api_version 14 moved this route to snake_case with the rest of the API.
    enum CodingKeys: String, CodingKey {
        case runId = "run_id"
        case agentId = "agent_id"
    }
}
