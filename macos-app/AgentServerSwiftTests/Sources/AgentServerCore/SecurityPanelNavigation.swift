public struct SecurityPanelNavigationState: Equatable, Sendable {
    public private(set) var selectedAgentId: String?
    public private(set) var selectedFindingId: String?

    public init(selectedAgentId: String? = nil, selectedFindingId: String? = nil) {
        self.selectedAgentId = selectedAgentId
        self.selectedFindingId = selectedAgentId == nil ? nil : selectedFindingId
    }

    public var visiblePanelCount: Int {
        if selectedFindingId != nil { return 3 }
        return selectedAgentId == nil ? 1 : 2
    }

    public var analysisIdentity: String? { selectedAgentId }

    public mutating func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
        selectedFindingId = nil
    }

    public mutating func selectFinding(_ findingId: String) {
        guard selectedAgentId != nil else { return }
        selectedFindingId = findingId
    }

    @discardableResult
    public mutating func stepBack() -> Bool {
        if selectedFindingId != nil {
            selectedFindingId = nil
            return true
        }
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

public enum SecurityPanelSurfaceStyle: Equatable, Sendable {
    case flatSections
}

public enum SecurityFindingStyle: Equatable, Sendable {
    case rows
}

public enum SecurityTextRole: Equatable, Sendable {
    case title
    case body
    case secondary
    case technical
}

public enum SecurityRowAccessory: Equatable, Sendable {
    case disclosure
}

public struct SecurityPanelVisualPolicy: Equatable, Sendable {
    public let surfaceStyle: SecurityPanelSurfaceStyle
    public let findingStyle: SecurityFindingStyle
    public let textRoles: [SecurityTextRole]

    public init(
        surfaceStyle: SecurityPanelSurfaceStyle = .flatSections,
        findingStyle: SecurityFindingStyle = .rows,
        textRoles: [SecurityTextRole] = [.title, .body, .secondary, .technical]
    ) {
        self.surfaceStyle = surfaceStyle
        self.findingStyle = findingStyle
        self.textRoles = textRoles
    }
}

public struct SecurityRowPresentation: Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let status: String
    public let severity: ConsumerRiskLevel?
    public let accessory: SecurityRowAccessory
    public let isSelected: Bool
    public let titleRole: SecurityTextRole
    public let detailRole: SecurityTextRole

    public init(
        id: String,
        title: String,
        detail: String,
        status: String,
        severity: ConsumerRiskLevel?,
        accessory: SecurityRowAccessory = .disclosure,
        isSelected: Bool
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.status = status
        self.severity = severity
        self.accessory = accessory
        self.isSelected = isSelected
        self.titleRole = .body
        self.detailRole = .secondary
    }

    public var visibleText: String {
        [title, detail, status].joined(separator: " ")
    }
}

public extension SecurityAgentPresentation {
    func securityRow(isSelected: Bool) -> SecurityRowPresentation {
        switch result {
        case .checked(let risk, let findingCount, let isStale):
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: isStale ? "Changed since its last review" : findingCountLabel(findingCount),
                status: risk.title,
                severity: risk,
                isSelected: isSelected
            )
        case .failed(let message):
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: message ?? "The security check did not finish.",
                status: "Could not check",
                severity: nil,
                isSelected: isSelected
            )
        case .pending:
            return SecurityRowPresentation(
                id: id,
                title: name,
                detail: "This agent was not checked.",
                status: "Waiting",
                severity: nil,
                isSelected: isSelected
            )
        }
    }

    private func findingCountLabel(_ count: Int) -> String {
        count == 1 ? "1 thing to review" : "\(count) things to review"
    }
}

public extension SecurityFindingPresentation {
    func securityRow(isSelected: Bool) -> SecurityRowPresentation {
        SecurityRowPresentation(
            id: id,
            title: title,
            detail: whyItMatters,
            status: severity.title,
            severity: severity,
            isSelected: isSelected
        )
    }
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
    public var visualPolicy: SecurityPanelVisualPolicy { SecurityPanelVisualPolicy() }

    public var overallStatusContent: SecurityOverallStatusContent {
        scanPhase == .scanning ? .scanProgress : .summary
    }
}
