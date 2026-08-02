public enum AgentDetailCapabilityStyle: Equatable, Sendable {
    case iconText
}

public enum AgentDetailPresentation {
    public static let lastRunTitle = "Last run"
    public static let producedTitle = "Produced"
    public static let notesTitle = "Agent notes"
    public static let capabilitiesTitle = "This assistant can"
    public static let capabilityStyle = AgentDetailCapabilityStyle.iconText
    public static let emptyStateSupportingCopy: String? = nil
}

public enum AgentSafetyReadinessAction: Equatable, Sendable {
    case openSettings
    case reviewSecurity
}

public enum AgentSafetyReadinessRowStyle: Equatable, Sendable {
    case flatDisclosure
}

public enum AgentSafetyReadinessTextRole: Equatable, Sendable {
    case body
    case secondary
}

public struct AgentSafetyReadinessSupportingSurfacePresentation: Equatable, Sendable {
    public let rowStyle = AgentSafetyReadinessRowStyle.flatDisclosure
    public let usesCardBackground = false
    public let textRoles: [AgentSafetyReadinessTextRole] = [.body, .secondary]

    public init() {}
}

public struct AgentSafetyReadinessPresentation: Equatable, Sendable {
    public let title: String
    public let detail: String
    public let icon: String
    public let risk: ConsumerRiskLevel?
    public let action: AgentSafetyReadinessAction

    public init(
        securityResult: SecurityAgentResult,
        missingConnectionCount: Int
    ) {
        if missingConnectionCount > 0 {
            title = "Needs setup"
            let noun = missingConnectionCount == 1 ? "app needs" : "apps need"
            detail = "\(missingConnectionCount) connected \(noun) attention before this assistant can run."
            icon = "link.badge.plus"
            risk = nil
            action = .openSettings
            return
        }

        switch securityResult {
        case .checked(let checkedRisk, let findingCount, let isStale):
            if isStale {
                title = "Needs another review"
                detail = "This agent changed after its last security check."
            } else {
                title = checkedRisk.title
                detail = Self.findingDetail(count: findingCount)
            }
            icon = "checkmark.shield"
            risk = checkedRisk
        case .failed(let message):
            title = "Security check did not finish"
            detail = message ?? "Try the security check again."
            icon = "exclamationmark.shield"
            risk = nil
        case .pending:
            title = "Safety not checked yet"
            detail = "Open the security check before this assistant's first run."
            icon = "shield"
            risk = nil
        }
        action = .reviewSecurity
    }

    private static func findingDetail(count: Int) -> String {
        guard count > 0 else { return "Security check found no issues." }
        let noun = count == 1 ? "finding needs" : "findings need"
        return "\(count) security \(noun) review."
    }
}
