public enum AgentDetailTab: String, CaseIterable, Equatable, Sendable {
    case recentRuns
    case editAgent
    case runHistory

    public var title: String {
        switch self {
        case .recentRuns: "Overview"
        case .editAgent: "Edit"
        case .runHistory: "History"
        }
    }

    public var accessibilityIdentifier: String {
        "agentDetail.tab.\(rawValue)"
    }
}

public enum AgentDetailSection: Equatable, Sendable {
    case lastRun
    case capabilities
    case agentEditor
    case runHistory
}

public struct AgentDetailPresentationState: Equatable, Sendable {
    public private(set) var agentId: String
    public private(set) var selectedTab = AgentDetailTab.recentRuns
    public private(set) var selectedRunId: String?

    public init(agentId: String) {
        self.agentId = agentId
    }

    public var sections: [AgentDetailSection] {
        switch selectedTab {
        case .recentRuns: [.lastRun, .capabilities]
        case .editAgent: [.agentEditor]
        case .runHistory: [.runHistory]
        }
    }

    public var showsHeaderActions: Bool {
        selectedTab != .recentRuns
    }

    public mutating func select(_ tab: AgentDetailTab) {
        selectedTab = tab
        if tab != .runHistory { selectedRunId = nil }
    }

    public mutating func selectAgent(id: String) {
        guard id != agentId else { return }
        agentId = id
        selectedTab = .recentRuns
        selectedRunId = nil
    }

    public mutating func openRun(id: String) {
        selectedRunId = id
        selectedTab = .runHistory
    }
}

public enum AgentDetailHeaderRunTone: Equatable, Sendable {
    case standard
    case highlight
}

public struct AgentDetailHeaderRunPresentation: Equatable, Sendable {
    public let symbol: String
    public let tone: AgentDetailHeaderRunTone
    public let isDisabled: Bool
    public let help: String

    public init(isAgentEnabled: Bool, isRunning: Bool) {
        if isRunning {
            symbol = "arrow.triangle.2.circlepath"
            tone = .highlight
            isDisabled = true
            help = "Agent is running"
        } else {
            symbol = "play.fill"
            tone = .standard
            isDisabled = !isAgentEnabled
            help = isAgentEnabled ? "Run assistant now" : "Enable this assistant before running it"
        }
    }
}

public enum AgentDetailSecurityIndicatorTone: Equatable, Sendable {
    case good
    case warning
    case critical
}

public struct AgentDetailSecurityIndicatorPresentation: Equatable, Sendable {
    public let tone: AgentDetailSecurityIndicatorTone
    public let symbol: String
    public let help: String

    public init(result: SecurityAgentResult, missingConnectionCount: Int) {
        if missingConnectionCount > 0 {
            let noun = missingConnectionCount == 1 ? "app needs" : "apps need"
            tone = .warning
            symbol = "exclamationmark.shield.fill"
            help = "\(missingConnectionCount) connected \(noun) attention."
            return
        }

        switch result {
        case .checked(let risk, let findingCount, let isStale):
            if risk == .critical {
                tone = .critical
                symbol = "xmark.shield.fill"
                help = findingCount == 1
                    ? "Critical. 1 security finding needs review."
                    : "Critical. \(findingCount) security findings need review."
            } else if risk == .low, findingCount == 0, !isStale {
                tone = .good
                symbol = "checkmark.shield"
                help = "Security check found no issues."
            } else {
                tone = .warning
                symbol = "exclamationmark.shield.fill"
                if isStale {
                    help = "This agent changed after its last security check."
                } else if findingCount > 0 {
                    let noun = findingCount == 1 ? "finding needs" : "findings need"
                    help = "\(findingCount) security \(noun) review."
                } else {
                    help = "\(risk.title). Review the security check."
                }
            }
        case .failed(let message):
            tone = .warning
            symbol = "exclamationmark.shield.fill"
            help = message ?? "Security check did not finish."
        case .pending:
            tone = .warning
            symbol = "exclamationmark.shield.fill"
            help = "Security has not been checked yet."
        }
    }
}
