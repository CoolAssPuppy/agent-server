enum MainFooterUtilityDestination: CaseIterable {
    case settings

    var title: String {
        switch self {
        case .settings: "Settings"
        }
    }

    var help: String {
        switch self {
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .settings: "gearshape"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .settings: ConsumerFlowAccessibility.settingsNavigation
        }
    }

    var isIconOnly: Bool { true }

    func open(using router: DrawerRouter) {
        switch self {
        case .settings: router.openSettings()
        }
    }
}
