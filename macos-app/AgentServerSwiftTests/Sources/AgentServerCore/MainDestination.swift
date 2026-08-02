enum MainDestination: String, CaseIterable, Identifiable, Sendable {
    case today
    case assistants
    case activity
    case connections
    case settings

    static let defaultDestination = MainDestination.today
    static let desktopBarDestinations: [MainDestination] = [.today, .activity, .connections]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .assistants: "Assistants"
        case .activity: "Activity"
        case .connections: "Connections"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .today: "sun.max"
        case .assistants: "person.2"
        case .activity: "clock.arrow.circlepath"
        case .connections: "link"
        case .settings: "gearshape"
        }
    }

    var accessibilityLabel: String { title }

    var accessibilityIdentifier: String {
        "mainNavigation.\(rawValue)"
    }
}
