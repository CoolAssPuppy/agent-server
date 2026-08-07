import Foundation

struct Agent: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let schedule: String?
    let prompt: String
    let tools: [String]
    let maxTurns: Int
    let enabled: Bool
    let watch: [FileWatch]?
    let interaction: InteractionConfig?
    let notification: NotificationConfig?
    let onComplete: [TriggerRef]?
    let onFailure: [TriggerRef]?
    let disallowedTools: [String]?
    let timezone: String?
    let model: String?
    /// "claude-code" (default), "codex", or "kimi-code".
    /// Optional so older servers decode.
    let executor: String?
    /// Custom model provider (endpoint + ${VAR} key), when the agent runs on a
    /// non-default model. Optional so older servers decode.
    let provider: ProviderConfig?
    /// Human-readable service requirements from the shareable agent file.
    /// Machine-local connection IDs are fetched from the bindings route.
    let connections: [String: AgentConnectionUseServerModel]?
    let skills: [String: AgentSkillRequirementServerModel]?
    let runtimeSource: AgentRuntimeAssignmentResponse.Source?
    let runtimeRevision: Int?
    let timeout: String?
    let permissionMode: String?
    let workingDirectory: String?
    /// Derived by the server from tools/disallowed_tools/mcp_servers.
    /// Optional so the app still decodes agents from older servers.
    let capabilities: [AgentCapability]?

    enum CodingKeys: String, CodingKey {
        case id, name, description, schedule, prompt, tools, enabled
        case watch, interaction, notification, timezone, model, executor, provider, timeout, capabilities
        case connections, skills
        case runtimeSource = "runtime_source"
        case runtimeRevision = "runtime_revision"
        case maxTurns = "max_turns"
        case onComplete = "on_complete"
        case onFailure = "on_failure"
        case disallowedTools = "disallowed_tools"
        case permissionMode = "permission_mode"
        case workingDirectory = "working_directory"
    }

    var isScheduled: Bool {
        schedule != nil
    }

    var hasWatch: Bool {
        guard let watch else { return false }
        return !watch.isEmpty
    }

    var isInteractive: Bool {
        interaction != nil
    }

    var isChained: Bool {
        let hasComplete = onComplete.map { !$0.isEmpty } ?? false
        let hasFailure = onFailure.map { !$0.isEmpty } ?? false
        return hasComplete || hasFailure
    }

    var kind: AgentKind {
        if isInteractive { return .interactive }
        if hasWatch { return .watcher }
        if isScheduled { return .scheduled }
        if isChained { return .chained }
        return .onDemand
    }

    var scheduleDisplay: String {
        if let schedule {
            return CronEnglishFormatter.describe(schedule)
        }
        return AgentTriggerPresentation(schedule: nil, hasWatch: hasWatch).fallbackLabel ?? "On demand"
    }
}

/// A custom model provider (endpoint + key reference) for an agent. `apiKey`
/// holds a `${VAR}` reference resolved from `.env` at run time, never a literal
/// secret.
struct ProviderConfig: Codable, Equatable {
    let baseURL: String
    let apiKey: String?

    enum CodingKeys: String, CodingKey {
        case baseURL = "base_url"
        case apiKey = "api_key"
    }
}

/// One consumer-facing capability row ("Read your files", "Notion", ...)
/// derived server-side from the agent's YAML. Toggling sends the id back
/// via the capabilities field of an agent patch.
struct AgentCapability: Codable, Identifiable, Equatable {
    let id: String
    let label: String
    let description: String
    let icon: String
    let kind: String
    let source: String?
    /// How this connection authenticates: "none", "api_key", or "oauth".
    /// Optional so agents from an older server still decode.
    let auth: ConnectionAuth?
    let enabled: Bool
    let custom: Bool
    let requiredEnv: [String]
    let envReady: Bool
    let serverName: String?
    /// Connection status from the discovery probe when this capability maps to
    /// a reachable runtime connector ("connected", "needs-auth", "failed", …).
    /// Absent for local tools and unconfigured services.
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id, label, description, icon, kind, source, auth, enabled, custom, status
        case requiredEnv = "required_env"
        case envReady = "env_ready"
        case serverName = "server_name"
    }

    var category: ConnectionCategory {
        ConnectionCategory(
            capabilityID: id,
            kind: kind,
            auth: auth?.rawValue ?? "none",
            source: source
        )
    }
}

/// How a connection authenticates. Drives which Connect flow the app runs.
/// Unknown/absent values decode as `.none` so future servers never crash us.
enum ConnectionAuth: String, Codable, Equatable {
    case none
    case apiKey = "api_key"
    case oauth

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ConnectionAuth(rawValue: raw) ?? .none
    }
}

/// Catalog entry from GET /capabilities, used by the new-agent flow to
/// offer every known capability before the agent exists.
struct CapabilityCatalogEntry: Codable, Identifiable, Equatable {
    let id: String
    let label: String
    let description: String
    let icon: String
    let kind: String
    let auth: ConnectionAuth?
    let builtin: Bool
    let requiredEnv: [String]
    let envReady: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, description, icon, kind, auth, builtin
        case requiredEnv = "required_env"
        case envReady = "env_ready"
    }
}

struct CapabilityCatalogResponse: Codable {
    let capabilities: [CapabilityCatalogEntry]
}

/// One MCP server the Claude runtime reported it can reach — an account
/// connector ("claude.ai Slack"), a plugin, or a local server ("eventkit").
struct DiscoveredConnection: Codable, Identifiable, Equatable {
    let name: String
    let status: String
    let error: String?

    var id: String { name }

    /// True when the runtime is actively connected (not needs-auth / failed).
    var isConnected: Bool { status == "connected" }
    var needsAuth: Bool { status == "needs-auth" }

    /// A human label: drop the "claude.ai " account-connector prefix and take
    /// the last segment of a "plugin:x:y" name, so rows read "Slack", "Figma".
    var displayName: String {
        var rest = name
        if let range = rest.range(of: "claude.ai ", options: [.caseInsensitive, .anchored]) {
            rest.removeSubrange(range)
        }
        if rest.lowercased().hasPrefix("plugin:") {
            let parts = rest.split(separator: ":")
            if let last = parts.last { rest = String(last) }
        }
        return rest.isEmpty ? name : rest
    }
}

/// The cached discovery snapshot from GET /connections. `discoveredAt` is nil
/// until the server's first probe completes.
struct ConnectionSnapshot: Codable, Equatable {
    let servers: [DiscoveredConnection]
    let discoveredAt: String?
    let runtimes: [RuntimeConnection]
    let didProbeFail: Bool

    enum CodingKeys: String, CodingKey {
        case servers
        case discoveredAt = "discovered_at"
        case runtimes
        case didProbeFail = "probe_failed"
    }

    init(
        servers: [DiscoveredConnection],
        discoveredAt: String?,
        runtimes: [RuntimeConnection] = [],
        didProbeFail: Bool = false
    ) {
        self.servers = servers
        self.discoveredAt = discoveredAt
        self.runtimes = runtimes
        self.didProbeFail = didProbeFail
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        servers = try container.decode([DiscoveredConnection].self, forKey: .servers)
        discoveredAt = try container.decodeIfPresent(String.self, forKey: .discoveredAt)
        runtimes = try container.decodeIfPresent([RuntimeConnection].self, forKey: .runtimes) ?? []
        didProbeFail = try container.decodeIfPresent(Bool.self, forKey: .didProbeFail) ?? false
    }

    static let empty = ConnectionSnapshot(
        servers: [],
        discoveredAt: nil,
        runtimes: [],
        didProbeFail: false
    )
}

struct FileWatch: Codable {
    let path: String
    let glob: String?
}

struct InteractionConfig: Codable {
    let channel: String?
    let onReply: String?
    let timeout: String?

    enum CodingKeys: String, CodingKey {
        case channel, timeout
        case onReply = "on_reply"
    }
}

struct NotificationConfig: Codable {
    let channel: String?
    let onComplete: Bool?
    let onFailure: Bool?

    enum CodingKeys: String, CodingKey {
        case channel
        case onComplete = "on_complete"
        case onFailure = "on_failure"
    }
}

struct TriggerRef: Codable {
    let agent: String
}

enum AgentKind {
    case scheduled
    case interactive
    case watcher
    case chained
    case onDemand

    var icon: String {
        switch self {
        case .scheduled: return "clock"
        case .interactive: return "bubble.left.and.bubble.right"
        case .watcher: return "eye"
        case .chained: return "link"
        case .onDemand: return "play.circle"
        }
    }

    var label: String {
        switch self {
        case .scheduled: return "Scheduled"
        case .interactive: return "Interactive"
        case .watcher: return "File watch"
        case .chained: return "Chained"
        case .onDemand: return "On demand"
        }
    }

    var color: AgentKindColor {
        switch self {
        case .scheduled: return AgentKindColor(r: 0.35, g: 0.55, b: 0.95)    // blue
        case .interactive: return AgentKindColor(r: 0.65, g: 0.40, b: 0.85)  // purple
        case .watcher: return AgentKindColor(r: 0.25, g: 0.70, b: 0.75)      // teal
        case .chained: return AgentKindColor(r: 0.85, g: 0.55, b: 0.25)      // orange
        case .onDemand: return AgentKindColor(r: 0.30, g: 0.72, b: 0.45)     // green
        }
    }
}

struct AgentKindColor {
    let r: Double
    let g: Double
    let b: Double
}
