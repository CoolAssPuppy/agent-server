public struct SecurityPanelNavigationState: Equatable, Sendable {
    public private(set) var selectedAgentId: String?

    public init(selectedAgentId: String? = nil) {
        self.selectedAgentId = selectedAgentId
    }

    public var visiblePanelCount: Int {
        selectedAgentId == nil ? 1 : 2
    }

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
