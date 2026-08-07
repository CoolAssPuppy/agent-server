import Foundation

public struct ConnectionProfileListResponse: Codable, Equatable, Sendable {
    public let connections: [ConnectionProfile]

    public init(connections: [ConnectionProfile]) {
        self.connections = connections
    }
}

public struct ConnectionLabelRequest: Codable, Equatable, Sendable {
    public let label: String

    public init(label: String) {
        self.label = label
    }
}

public struct ConnectionReadinessResponse: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Equatable, Sendable {
        case ready
        case needsCredentials = "needs_credentials"
    }

    public let status: Status
    public let missingCredentials: [String]

    public init(status: Status, missingCredentials: [String]) {
        self.status = status
        self.missingCredentials = missingCredentials
    }

    enum CodingKeys: String, CodingKey {
        case status
        case missingCredentials = "missing_credentials"
    }
}

public struct ConnectionReadinessPresentation: Equatable, Sendable {
    public let title: String
    public let explanation: String
    public let isReady: Bool

    public init(response: ConnectionReadinessResponse) {
        switch response.status {
        case .ready:
            title = "Ready to use"
            explanation = "The required credentials are available. The service itself will be checked when an agent uses it."
            isReady = true
        case .needsCredentials:
            title = "Needs credentials"
            let references = response.missingCredentials.joined(separator: ", ")
            explanation = "Add \(references) before an agent uses this connection."
            isReady = false
        }
    }
}

public struct ConnectionAgentReference: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
}

public struct ConnectionRemovalConflict: Codable, Equatable, Sendable {
    public let error: String
    public let code: String
    public let agents: [ConnectionAgentReference]

    public var consumerExplanation: String {
        let names = agents.map(\.name)
        let list: String
        if names.count < 2 {
            list = names.first ?? "the agents that use it"
        } else if names.count == 2 {
            list = names.joined(separator: " and ")
        } else {
            list = names.dropLast().joined(separator: ", ") + ", and " + (names.last ?? "")
        }
        return "Remove this connection from \(list) before deleting it."
    }
}

public enum ConnectionCopyName {
    public static func suggested(from label: String) -> String {
        let suffix = " copy"
        return String(label.prefix(120 - suffix.count)).trimmingCharacters(in: .whitespaces) + suffix
    }
}

public struct ConnectionProfile: Codable, Equatable, Identifiable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let label: String
    public let serviceType: String?
    public let adapter: ConnectionAdapterRequest
    public let runtimeName: String
    public let credentials: [ConnectionCredentialReference]
    public let transport: ConnectionTransport
    public let createdAt: String
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, label, adapter, credentials, transport
        case serviceType = "service_type"
        case schemaVersion = "schema_version"
        case runtimeName = "runtime_name"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct ConnectionCredentialReference: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let environmentVariable: String
    public let secret: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, secret
        case environmentVariable = "environment_variable"
    }
}

public struct ConnectionCredentialHeader: Codable, Equatable, Sendable {
    public let name: String
    public let credentialID: String
    public let prefix: String

    public init(name: String, credentialID: String, prefix: String) {
        self.name = name
        self.credentialID = credentialID
        self.prefix = prefix
    }

    enum CodingKeys: String, CodingKey {
        case name, prefix
        case credentialID = "credential_id"
    }
}

public enum ConnectionTransport: Codable, Equatable, Sendable {
    case stdio(command: String, arguments: [String], environment: [String: String])
    case http(url: String, headers: [ConnectionCredentialHeader])
    case serverSentEvents(url: String, headers: [ConnectionCredentialHeader])
    case runtimeAccount(executor: String, serverName: String)

    private enum Kind: String, Codable {
        case stdio = "mcp_stdio"
        case http = "mcp_http"
        case serverSentEvents = "mcp_sse"
        case runtimeAccount = "runtime_account"
    }

    private enum CodingKeys: String, CodingKey {
        case kind, command, args, environment, url, headers, executor
        case serverName = "server_name"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .stdio:
            self = .stdio(
                command: try container.decode(String.self, forKey: .command),
                arguments: try container.decode([String].self, forKey: .args),
                environment: try container.decode([String: String].self, forKey: .environment)
            )
        case .http:
            self = .http(
                url: try container.decode(String.self, forKey: .url),
                headers: try container.decode([ConnectionCredentialHeader].self, forKey: .headers)
            )
        case .serverSentEvents:
            self = .serverSentEvents(
                url: try container.decode(String.self, forKey: .url),
                headers: try container.decode([ConnectionCredentialHeader].self, forKey: .headers)
            )
        case .runtimeAccount:
            self = .runtimeAccount(
                executor: try container.decode(String.self, forKey: .executor),
                serverName: try container.decode(String.self, forKey: .serverName)
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .stdio(let command, let arguments, let environment):
            try container.encode(Kind.stdio, forKey: .kind)
            try container.encode(command, forKey: .command)
            try container.encode(arguments, forKey: .args)
            try container.encode(environment, forKey: .environment)
        case .http(let url, let headers):
            try container.encode(Kind.http, forKey: .kind)
            try container.encode(url, forKey: .url)
            try container.encode(headers, forKey: .headers)
        case .serverSentEvents(let url, let headers):
            try container.encode(Kind.serverSentEvents, forKey: .kind)
            try container.encode(url, forKey: .url)
            try container.encode(headers, forKey: .headers)
        case .runtimeAccount(let executor, let serverName):
            try container.encode(Kind.runtimeAccount, forKey: .kind)
            try container.encode(executor, forKey: .executor)
            try container.encode(serverName, forKey: .serverName)
        }
    }
}
