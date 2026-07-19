import Foundation

public struct ConnectionCredentialDraft: Equatable, Identifiable, Sendable {
    public let id: UUID
    public var label: String
    public var environmentVariable: String
    public var value: String
    public var targetName: String
    public var prefix: String

    public init(
        id: UUID = UUID(),
        label: String,
        environmentVariable: String,
        value: String = "",
        targetName: String = "Authorization",
        prefix: String = "Bearer "
    ) {
        self.id = id
        self.label = label
        self.environmentVariable = environmentVariable
        self.value = value
        self.targetName = targetName
        self.prefix = prefix
    }
}

public struct ConnectionAdapterRequest: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
}

public struct ConnectionCredentialReferenceRequest: Codable, Equatable, Sendable {
    public let label: String
    public let environmentVariable: String
    public let secret: Bool

    enum CodingKeys: String, CodingKey {
        case label, secret
        case environmentVariable = "environment_variable"
    }
}

public struct ConnectionHeaderRequest: Codable, Equatable, Sendable {
    public let name: String
    public let credentialIndex: Int
    public let prefix: String

    enum CodingKeys: String, CodingKey {
        case name, prefix
        case credentialIndex = "credential_index"
    }
}

public struct ConnectionTransportRequest: Codable, Equatable, Sendable {
    public let kind: String
    public let url: String?
    public let headers: [ConnectionHeaderRequest]?
    public let command: String?
    public let args: [String]?
    public let environment: [String: Int]?
}

public struct ConnectionProfileCreateRequest: Codable, Equatable, Sendable {
    public let label: String
    public let adapter: ConnectionAdapterRequest
    public let runtimeName: String?
    public let credentials: [ConnectionCredentialReferenceRequest]
    public let transport: ConnectionTransportRequest

    enum CodingKeys: String, CodingKey {
        case label, adapter, credentials, transport
        case runtimeName = "runtime_name"
    }
}

public enum ConnectionSetupError: Error, Equatable {
    case missingLabel
    case invalidURL
    case missingCommand
    case invalidEnvironmentVariable(String)
    case duplicateEnvironmentVariable(String)
    case duplicateTargetName(String)
}

public struct ConnectionSetupDraft: Equatable, Sendable {
    public enum Method: String, Equatable, Sendable {
        case web
        case local
    }

    public var label: String
    public var adapterID: String
    public var method: Method
    public var webURL: String
    public var command: String
    public var arguments: [String]
    public var credentials: [ConnectionCredentialDraft]
    private var testedFingerprint: String?

    public static func web(
        label: String,
        url: String,
        credentials: [ConnectionCredentialDraft] = []
    ) -> Self {
        Self(
            label: label,
            adapterID: "mcp.custom",
            method: .web,
            webURL: url,
            command: "",
            arguments: [],
            credentials: credentials
        )
    }

    public static func local(
        label: String,
        command: String,
        arguments: [String] = [],
        credentials: [ConnectionCredentialDraft] = []
    ) -> Self {
        Self(
            label: label,
            adapterID: "mcp.custom",
            method: .local,
            webURL: "",
            command: command,
            arguments: arguments,
            credentials: credentials
        )
    }

    public var environmentValues: [String: String] {
        credentials.reduce(into: [:]) { values, credential in
            let value = credential.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, values[credential.environmentVariable] == nil {
                values[credential.environmentVariable] = value
            }
        }
    }

    public var isTestCurrent: Bool {
        testedFingerprint == connectionFingerprint
    }

    public mutating func markTested() {
        testedFingerprint = connectionFingerprint
    }

    public func makeRequest() throws -> ConnectionProfileCreateRequest {
        guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConnectionSetupError.missingLabel
        }
        for credential in credentials where !Self.isValidEnvironmentVariable(credential.environmentVariable) {
            throw ConnectionSetupError.invalidEnvironmentVariable(credential.environmentVariable)
        }
        try validateUniqueCredentialBindings()
        return ConnectionProfileCreateRequest(
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            adapter: ConnectionAdapterRequest(id: adapterID, version: 1),
            runtimeName: nil,
            credentials: credentials.map {
                ConnectionCredentialReferenceRequest(
                    label: $0.label,
                    environmentVariable: $0.environmentVariable,
                    secret: true
                )
            },
            transport: try transportRequest()
        )
    }

    private func transportRequest() throws -> ConnectionTransportRequest {
        switch method {
        case .web:
            guard let url = URL(string: webURL), url.scheme == "https" else {
                throw ConnectionSetupError.invalidURL
            }
            let headers = credentials.enumerated().map { index, credential in
                ConnectionHeaderRequest(name: credential.targetName, credentialIndex: index, prefix: credential.prefix)
            }
            return ConnectionTransportRequest(
                kind: "mcp_http", url: webURL, headers: headers,
                command: nil, args: nil, environment: nil
            )
        case .local:
            guard !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ConnectionSetupError.missingCommand
            }
            let environment = Dictionary(uniqueKeysWithValues: credentials.enumerated().map { index, credential in
                (credential.targetName, index)
            })
            return ConnectionTransportRequest(
                kind: "mcp_stdio", url: nil, headers: nil,
                command: command, args: arguments, environment: environment
            )
        }
    }

    private func validateUniqueCredentialBindings() throws {
        if let duplicate = Self.firstDuplicate(credentials.map(\.environmentVariable)) {
            throw ConnectionSetupError.duplicateEnvironmentVariable(duplicate)
        }
        guard method == .local,
              let duplicate = Self.firstDuplicate(credentials.map(\.targetName)) else { return }
        throw ConnectionSetupError.duplicateTargetName(duplicate)
    }

    private static func firstDuplicate(_ values: [String]) -> String? {
        var seen: Set<String> = []
        return values.first { !seen.insert($0).inserted }
    }

    private var connectionFingerprint: String {
        let credentialShape = credentials.map {
            [$0.label, $0.environmentVariable, $0.targetName, $0.prefix].joined(separator: "|")
        }.joined(separator: ";")
        return [adapterID, method.rawValue, webURL, command, arguments.joined(separator: "\u{1f}"), credentialShape]
            .joined(separator: "\u{1e}")
    }

    private static func isValidEnvironmentVariable(_ value: String) -> Bool {
        value.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil
    }
}
