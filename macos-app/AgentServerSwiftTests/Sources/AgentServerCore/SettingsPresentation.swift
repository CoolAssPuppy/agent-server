import Foundation

public enum ProductAnalyticsConsent {
    public static func isOptedIn(storedValue: Bool?) -> Bool {
        storedValue == true
    }
}

public enum SettingsSection: String, CaseIterable, Equatable, Sendable {
    case general
    case device
    case pairing
    case notifications
    case updates
    case storage
    case agentPanel
    case telemetry
    case environment

    public var title: String {
        switch self {
        case .general: "General"
        case .device: "This Mac"
        case .pairing: "Pair with Agent Panel"
        case .notifications: "Notifications"
        case .updates: "Updates"
        case .storage: "Local server"
        case .agentPanel: "Agent Panel"
        case .telemetry: "Diagnostics and telemetry"
        case .environment: "Environment"
        }
    }
}

public enum SettingsSectionStyle: Equatable, Sendable {
    case card
}

public struct SettingsGroupTitleInteraction: Equatable, Sendable {
    public let hasContextAction: Bool

    public init(hasContextAction: Bool) {
        self.hasContextAction = hasContextAction
    }

    public var allowsTextSelection: Bool {
        !hasContextAction
    }
}

public enum SettingsPresentation {
    public static let sectionStyle = SettingsSectionStyle.card
    public static let drawerTitleFontSize: Double = 18
    public static let cardHeadingFontSize: Double = 10
    public static let rowTitleFontSize: Double = 13
    public static let supportingFontSize: Double = 11
    public static let cardHeadingTracking: Double = 0.6
    public static let usesUppercaseCardHeadings = true
    public static let interCardSpacing: Double = 14
    public static let outerHorizontalPadding: Double = 22
    public static let outerTopPadding: Double = 18
    public static let outerBottomPadding: Double = 14
    public static let headerHorizontalPadding: Double = 24
    public static let headerVerticalPadding: Double = 18
    public static let cardHorizontalPadding: Double = 20
    public static let cardVerticalPadding: Double = 18
    public static let cardHeadingBottomPadding: Double = 12
    public static let rowHorizontalSpacing: Double = 12
    public static let rowTextSpacing: Double = 2
    public static let rowDividerVerticalPadding: Double = 10
    public static let secondaryButtonFontSize: Double = 11
    public static let secondaryButtonHorizontalPadding: Double = 11
    public static let secondaryButtonVerticalPadding: Double = 6
    public static let secondaryButtonCornerRadius: Double = 8
    public static let iconButtonFontSize: Double = 12
    public static let iconButtonWidth: Double = 28
    public static let iconButtonHeight: Double = 26

    // Appearance is chosen from the menu bar, so a second place to set it was
    // one place too many. The AI engine repeated what the runtime picker
    // already says, and security is set where the thing being secured lives.
    public static let primarySections: [SettingsSection] = [
        .general,
        .device,
        .pairing,
        .notifications,
        .updates,
    ]

    public static let advancedSections: [SettingsSection] = [
        .storage,
        .agentPanel,
        .telemetry,
        .environment,
    ]

    public static func columnCount(availableWidth: Double) -> Int {
        availableWidth >= 760 ? 2 : 1
    }

    // Pairing leads the right column: it is the one thing here that changes
    // what the product can do, and everything under it is a preference.
    public static let primaryColumns: [[SettingsSection]] = [
        [.general, .device],
        [.pairing, .notifications, .updates],
    ]

    public static let advancedColumns: [[SettingsSection]] = [
        [.storage, .environment],
        [.agentPanel, .telemetry],
    ]
}

public struct CurrentDevicePresentation: Equatable, Sendable {
    public let machineID: String
    public let protocolVersion: Int
    public let serverVersion: String
    public let assistantCount: Int
    public let isServerReachable: Bool
    public let lastHeardAt: Date?

    public init(
        machineID: String,
        protocolVersion: Int,
        serverVersion: String,
        assistantCount: Int,
        isServerReachable: Bool,
        lastHeardAt: Date?
    ) {
        self.machineID = machineID
        self.protocolVersion = protocolVersion
        self.serverVersion = serverVersion
        self.assistantCount = assistantCount
        self.isServerReachable = isServerReachable
        self.lastHeardAt = lastHeardAt
    }

    public var name: String { "This Mac" }
    public var status: String { isServerReachable ? "Online" : "Local server unavailable" }
    public var assistantCountText: String {
        "\(assistantCount) \(assistantCount == 1 ? "agent" : "agents")"
    }
    public var lastHeardText: String {
        lastHeardAt == nil ? "Not checked yet" : "Last heard recently"
    }
    public var protocolText: String { "Protocol \(protocolVersion)" }
    public var serverVersionText: String { "Agent Server \(serverVersion)" }

    public static func normalizedName(_ candidate: String) -> String {
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "This Mac" }
        return String(trimmed.prefix(80))
    }
}
