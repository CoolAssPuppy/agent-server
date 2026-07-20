public enum SettingsSection: String, CaseIterable, Equatable, Sendable {
    case general
    case runtimes
    case notifications
    case storage
    case updates
    case agentPanel
    case environment

    public var title: String {
        switch self {
        case .general: "General"
        case .runtimes: "Coding agents"
        case .notifications: "Notifications"
        case .storage: "Agent Server folder"
        case .updates: "Updates"
        case .agentPanel: "Agent Panel"
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

    public static let primarySections: [SettingsSection] = [
        .general,
        .runtimes,
        .notifications,
        .storage,
        .updates,
    ]

    public static let advancedSections: [SettingsSection] = [
        .agentPanel,
        .environment,
    ]

    public static func columnCount(availableWidth: Double) -> Int {
        availableWidth >= 640 ? 2 : 1
    }

    public static func primaryColumns(columnCount: Int) -> [[SettingsSection]] {
        guard columnCount > 1 else { return [primarySections] }
        return [
            [.general, .runtimes, .notifications],
            [.storage, .updates],
        ]
    }
}
