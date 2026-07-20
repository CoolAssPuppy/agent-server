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

public enum SettingsPresentation {
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

}
