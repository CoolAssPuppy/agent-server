enum MainFooterUtilityDestination: CaseIterable {
    case security
    case connections
    case settings

    var title: String {
        switch self {
        case .security: "Security check"
        case .connections: "Connections"
        case .settings: "Settings"
        }
    }

    var help: String {
        switch self {
        case .security: "Review agent access and safety"
        case .connections: "Services your agents can use"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .security: "checkmark.shield"
        case .connections: "link"
        case .settings: "gearshape"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .security: ConsumerFlowAccessibility.securityNavigation
        case .connections: ConsumerFlowAccessibility.connectionsNavigation
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
