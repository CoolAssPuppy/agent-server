/// Icon-only destinations along the bottom-right of the main pane, in the
/// order they appear: security, then connections, then settings.
enum MainFooterUtilityDestination: CaseIterable {
    case security
    case connections
    case settings

    var title: String {
        switch self {
        case .security: "Security"
        case .connections: "Connections"
        case .settings: "Settings"
        }
    }

    var help: String { title }

    var systemImage: String {
        switch self {
        case .security: "shield"
        case .connections: "link"
        case .settings: "gearshape"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .security: "footer.security"
        case .connections: "footer.connections"
        case .settings: ConsumerFlowAccessibility.settingsNavigation
        }
    }

    var isIconOnly: Bool { true }

    func open(using router: DrawerRouter) {
        switch self {
        case .security: router.openSecurity()
        case .connections: router.openConnections()
        case .settings: router.openSettings()
        }
    }
}
