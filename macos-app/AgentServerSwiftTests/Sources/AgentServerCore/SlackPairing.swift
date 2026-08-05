import Foundation

public enum SlackPairingState: String, Codable, Equatable, Sendable {
    case notConfigured = "not_configured"
    case starting
    case needsPairing = "needs_pairing"
    case error
    case ready
}

public struct SlackPairingStatus: Codable, Equatable, Sendable {
    public let state: SlackPairingState
    public let openURL: URL?
    public let canOpenSlack: Bool
    public let canTest: Bool

    public init(
        state: SlackPairingState,
        openURL: URL? = nil,
        canOpenSlack: Bool,
        canTest: Bool
    ) {
        self.state = state
        self.openURL = openURL
        self.canOpenSlack = canOpenSlack
        self.canTest = canTest
    }

    public static let notConfigured = SlackPairingStatus(
        state: .notConfigured,
        canOpenSlack: false,
        canTest: false
    )
    public static let starting = SlackPairingStatus(
        state: .starting,
        canOpenSlack: false,
        canTest: false
    )
    public static let needsPairing = SlackPairingStatus(
        state: .needsPairing,
        canOpenSlack: false,
        canTest: false
    )
    public static let error = SlackPairingStatus(
        state: .error,
        canOpenSlack: false,
        canTest: false
    )
    public static let ready = SlackPairingStatus(
        state: .ready,
        canOpenSlack: true,
        canTest: true
    )

    private enum CodingKeys: String, CodingKey {
        case state
        case openURL = "open_url"
        case canOpenSlack = "can_open_slack"
        case canTest = "can_test"
    }
}

public struct SlackDestinationRequest: Codable, Equatable, Sendable {
    public let channelID: String

    public init(channelID: String) {
        self.channelID = channelID
    }

    private enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
    }
}

public struct SlackTestMessageResponse: Codable, Equatable, Sendable {
    public let sent: Bool
}

public struct SlackPairingPresentation: Equatable, Sendable {
    public let readinessTitle: String
    public let actionTitle: String
    public let isActionEnabled: Bool

    public init(status: SlackPairingStatus) {
        switch status.state {
        case .notConfigured:
            readinessTitle = "Needs setup"
            actionTitle = "Set up"
            isActionEnabled = true
        case .starting:
            readinessTitle = "Starting"
            actionTitle = "Starting"
            isActionEnabled = false
        case .needsPairing:
            readinessTitle = "Finish setup"
            actionTitle = "Finish setup"
            isActionEnabled = true
        case .error:
            readinessTitle = "Needs attention"
            actionTitle = "Manage"
            isActionEnabled = true
        case .ready:
            readinessTitle = "Ready"
            actionTitle = "Manage"
            isActionEnabled = true
        }
    }
}

public enum SlackConversationID {
    public static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    public static func isValid(_ value: String) -> Bool {
        normalized(value).range(
            of: #"^D[A-Z0-9]{8,31}$"#,
            options: .regularExpression
        ) != nil
    }
}
