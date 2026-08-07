import Foundation

public enum ConnectionScreenSection: String, CaseIterable, Equatable, Sendable {
    case saved
    case engines
    case claude
    case messaging
    case templates

    public static let primary: [Self] = [.saved, .engines, .messaging]
    public static let advanced: [Self] = [.templates]

    public var title: String {
        switch self {
        case .saved: "Your connections"
        case .engines: "AI engines"
        case .claude: "Available through Claude"
        case .messaging: "Messaging"
        case .templates: "Advanced connections"
        }
    }

    public var explanation: String {
        switch self {
        case .saved: "Accounts and tools you have set up for Agent Server."
        case .engines: "Installed coding agents and the MCP servers configured for them."
        case .claude: "Apps connected in Claude are available to your agents through your existing sign-in."
        case .messaging: "Chat with your agents and receive their replies."
        case .templates: "Quick setup for common services."
        }
    }

    public var isAdvanced: Bool { Self.advanced.contains(self) }
}

public struct RuntimeMcpServer: Codable, Equatable, Sendable {
    public let name: String
    public let status: String

    public init(name: String, status: String) {
        self.name = name
        self.status = status
    }
}

public struct RuntimeConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let installed: Bool
    public let authentication: String
    public let mcpServers: [RuntimeMcpServer]
    public let mcpInventoryState: String
    public let mcpEvidence: String

    enum CodingKeys: String, CodingKey {
        case id, label, installed, authentication
        case mcpServers = "mcp_servers"
        case mcpInventoryState = "mcp_inventory_state"
        case mcpEvidence = "mcp_evidence"
    }

    public init(
        id: String,
        label: String,
        installed: Bool,
        authentication: String,
        mcpServers: [RuntimeMcpServer] = [],
        mcpInventoryState: String = "not_checked",
        mcpEvidence: String = "configuration"
    ) {
        self.id = id
        self.label = label
        self.installed = installed
        self.authentication = authentication
        self.mcpServers = mcpServers
        self.mcpInventoryState = mcpInventoryState
        self.mcpEvidence = mcpEvidence
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        installed = try container.decode(Bool.self, forKey: .installed)
        authentication = try container.decode(String.self, forKey: .authentication)
        mcpServers = try container.decodeIfPresent(
            [RuntimeMcpServer].self,
            forKey: .mcpServers
        ) ?? []
        mcpInventoryState = try container.decodeIfPresent(String.self, forKey: .mcpInventoryState) ?? "not_checked"
        mcpEvidence = try container.decodeIfPresent(String.self, forKey: .mcpEvidence) ?? "configuration"
    }
}

public struct RuntimeMcpServerPresentation: Equatable, Sendable {
    public let name: String
    public let status: String

    public init(server: RuntimeMcpServer) {
        name = Self.displayName(server.name)
        status = server.status
    }

    public var statusTitle: String {
        switch status {
        case "connected": "Connected"
        case "needs_auth": "Needs sign-in"
        case "configured", "enabled": "Configured"
        case "disabled": "Disabled"
        case "failed": "Unavailable"
        case "pending": "Available"
        default: "Status unknown"
        }
    }

    private static func displayName(_ name: String) -> String {
        var result = name
        if result.lowercased().hasPrefix("claude.ai ") {
            result = String(result.dropFirst("claude.ai ".count))
        }
        if result.lowercased().hasPrefix("plugin:"), let last = result.split(separator: ":").last {
            result = String(last)
        }
        return result
    }
}

public struct RuntimeConnectionPresentation: Equatable, Identifiable, Sendable {
    public enum Status: Equatable, Sendable {
        case installed
        case notInstalled
    }

    public let id: String
    public let name: String
    public let status: Status
    public let mcpServers: [RuntimeMcpServerPresentation]
    public let mcpInventoryState: String
    public let authenticationSummary = "Sign-in checked when an agent runs"

    public init(runtime: RuntimeConnection) {
        id = runtime.id
        name = runtime.label
        status = runtime.installed ? .installed : .notInstalled
        mcpServers = runtime.mcpServers.map(RuntimeMcpServerPresentation.init)
        mcpInventoryState = runtime.mcpInventoryState
    }

    public var statusTitle: String {
        status == .installed ? "Installed" : "Not installed"
    }

    public var emptyMcpMessage: String? {
        guard status == .installed, mcpServers.isEmpty else { return nil }
        switch mcpInventoryState {
        case "failed": return "Could not check MCP servers"
        case "not_checked": return "Checking MCP servers…"
        default: return "No MCP servers configured"
        }
    }

    public var inventoryNotice: String? {
        guard mcpInventoryState == "failed", !mcpServers.isEmpty else { return nil }
        return "Could not refresh. Showing the last known MCP servers."
    }

    public var mcpCountTitle: String {
        let count = mcpServers.count
        return "\(count) MCP \(count == 1 ? "server" : "servers")"
    }
}

public struct ClaudeConnectionDiscoveryPresentation: Equatable, Sendable {
    public let discoveredAt: String?
    public let didProbeFail: Bool
    public let connectionCount: Int

    public init(discoveredAt: String?, didProbeFail: Bool, connectionCount: Int) {
        self.discoveredAt = discoveredAt
        self.didProbeFail = didProbeFail
        self.connectionCount = connectionCount
    }

    public var emptyMessage: String? {
        guard connectionCount == 0 else { return nil }
        if didProbeFail { return "Could not check Claude connections. Try again." }
        if discoveredAt == nil { return "Checking connections from Claude Code…" }
        return "No Claude connections found yet. Connect an app in Claude Code, then refresh."
    }
}

public enum ConnectionSetupSection: String, CaseIterable, Equatable, Sendable {
    case identity
    case method
    case credentials
    case technical

    public static let visible: [Self] = [.identity, .method, .credentials]
    public static let introductionTitle = "Add advanced connection"
    public static let introductionExplanation = "Set up a custom web endpoint or local command. Most people can connect apps through Claude or use a service template instead."

    public var title: String {
        switch self {
        case .identity: "Connection name"
        case .method: "How it connects"
        case .credentials: "Credentials"
        case .technical: "Technical details"
        }
    }

    public var isAdvanced: Bool { self == .technical }
}

public struct ConnectionProfilePresentation: Equatable, Identifiable, Sendable {
    public enum Status: Equatable, Sendable {
        case ready
        case needsCredentials
    }

    public let id: String
    public let name: String
    public let connectionMethod: String
    public let location: String
    public let credentialSummary: String
    public let credentialReferences: [String]
    public let status: Status
    public let category: ConnectionCategory

    public var rowSummary: String {
        "\(connectionMethod) · \(statusTitle)"
    }

    public var rowActionTitle: String {
        status == .ready ? "View" : "Add credentials"
    }
    public var technicalDetailsTitle: String { "Technical details" }

    public var statusTitle: String {
        status == .ready ? "Ready" : "Needs credentials"
    }

    public var statusExplanation: String {
        switch status {
        case .ready:
            "Agents can use this connection when you grant them access."
        case .needsCredentials:
            "Add the missing credential before an agent can use this connection."
        }
    }

    public init(profile: ConnectionProfile, configuredEnvironmentVariables: Set<String>) {
        id = profile.id
        name = profile.label
        credentialSummary = Self.credentialSummary(count: profile.credentials.count)
        credentialReferences = profile.credentials.map {
            "\($0.label) · \($0.environmentVariable)"
        }
        status = profile.credentials.allSatisfy {
            configuredEnvironmentVariables.contains($0.environmentVariable)
        } ? .ready : .needsCredentials
        category = profile.credentials.isEmpty ? .mcp : .api

        switch profile.transport {
        case .http(let url, _):
            connectionMethod = "Web service"
            location = url
        case .serverSentEvents(let url, _):
            connectionMethod = "Event stream"
            location = url
        case .stdio(let command, let arguments, _):
            connectionMethod = "Local command"
            location = ([command] + arguments).joined(separator: " ")
        case .runtimeAccount(let executor, let serverName):
            connectionMethod = "Coding agent account"
            location = "\(serverName) through \(executor)"
        }
    }

    private static func credentialSummary(count: Int) -> String {
        count == 1 ? "1 credential" : "\(count) credentials"
    }
}

public struct ConnectionPanelNavigationState: Equatable, Sendable {
    public private(set) var selectedConnectionID: String?

    public init(selectedConnectionID: String? = nil) {
        self.selectedConnectionID = selectedConnectionID
    }

    public mutating func selectConnection(_ id: String) {
        selectedConnectionID = id
    }

    @discardableResult
    public mutating func stepBack() -> Bool {
        guard selectedConnectionID != nil else { return false }
        selectedConnectionID = nil
        return true
    }
}
