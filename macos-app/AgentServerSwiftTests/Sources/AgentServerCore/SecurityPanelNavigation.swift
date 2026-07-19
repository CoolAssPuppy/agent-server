public struct SecurityPanelNavigationState: Equatable, Sendable {
    public private(set) var selectedAgentId: String?

    public init(selectedAgentId: String? = nil) {
        self.selectedAgentId = selectedAgentId
    }

    public var visiblePanelCount: Int {
        selectedAgentId == nil ? 1 : 2
    }

    public var analysisIdentity: String? { selectedAgentId }

    public mutating func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
    }

    @discardableResult
    public mutating func stepBack() -> Bool {
        guard selectedAgentId != nil else { return false }
        selectedAgentId = nil
        return true
    }
}

public enum SecurityPanelHeaderAction: Hashable, Sendable {
    case exportReport
    case scanAll

    public var systemImage: String {
        switch self {
        case .exportReport: "square.and.arrow.down"
        case .scanAll: "arrow.triangle.2.circlepath"
        }
    }
}

public enum SecurityOverallStatusContent: Equatable, Sendable {
    case summary
    case scanProgress
}

public struct SecurityPanelPresentation: Equatable, Sendable {
    public let scanPhase: SecurityBackgroundScanPhase

    public init(scanPhase: SecurityBackgroundScanPhase) {
        self.scanPhase = scanPhase
    }

    public var headerActions: [SecurityPanelHeaderAction] {
        [.exportReport, .scanAll]
    }

    public var showsSubtitle: Bool { false }
    public var showsAgentList: Bool { true }

    public var overallStatusContent: SecurityOverallStatusContent {
        scanPhase == .scanning ? .scanProgress : .summary
    }
}
