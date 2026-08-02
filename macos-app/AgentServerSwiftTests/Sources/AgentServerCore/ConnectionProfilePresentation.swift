import Foundation

public enum ConnectionScreenSection: String, CaseIterable, Equatable, Sendable {
    case saved
    case engines
    case claude
    case messaging
    case templates

    public static let primary: [Self] = [.saved, .engines, .claude, .messaging]
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
        case .engines: "Coding agents available on this Mac."
        case .claude: "Apps connected in Claude are available to your agents through your existing sign-in."
        case .messaging: "Chat with your agents and receive their replies."
        case .templates: "Quick setup for common services."
        }
    }

    public var isAdvanced: Bool { Self.advanced.contains(self) }
}

public struct RuntimeConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let installed: Bool
    public let authentication: String

    public init(id: String, label: String, installed: Bool, authentication: String) {
        self.id = id
        self.label = label
        self.installed = installed
        self.authentication = authentication
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
    public let authenticationSummary = "Sign-in checked when an agent runs"

    public init(runtime: RuntimeConnection) {
        id = runtime.id
        name = runtime.label
        status = runtime.installed ? .installed : .notInstalled
    }

    public var statusTitle: String {
        status == .installed ? "Installed" : "Not installed"
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
