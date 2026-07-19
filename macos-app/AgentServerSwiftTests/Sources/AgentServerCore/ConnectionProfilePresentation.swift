import Foundation

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

    public var rowSummary: String {
        "\(connectionMethod) · \(credentialSummary)"
    }

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
