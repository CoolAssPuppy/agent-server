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

    public static let primaryColumns: [[SettingsSection]] = [
        [.general, .runtimes, .notifications],
        [.storage, .updates],
    ]
}
