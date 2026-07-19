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
    public let status: Status

    public init(profile: ConnectionProfile, configuredEnvironmentVariables: Set<String>) {
        id = profile.id
        name = profile.label
        credentialSummary = Self.credentialSummary(count: profile.credentials.count)
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
