public enum SettingsSection: String, CaseIterable, Equatable, Sendable {
    case general
    case runtimes
    case notifications
    case storage
    case updates
    case agentPanel
    case environment
    case telemetry
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
        .telemetry,
    ]

    /// Two cards stay readable once each can retain about 300 points of width.
    /// Wider drawers remain at two columns to preserve a calm reading order.
    public static func columnCount(availableWidth: Double) -> Int {
        availableWidth >= 640 ? 2 : 1
    }
}
