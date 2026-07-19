public struct AgentPanelSettings: Equatable, Sendable {
    public let hasURL: Bool
    public let hasAPIKey: Bool
    public let isSendingEnabled: Bool

    public init(environment: [String: String]) {
        hasURL = !(environment["AGENT_SERVER_PANEL_URL"] ?? "").isEmpty
        hasAPIKey = !(environment["AGENT_SERVER_PANEL_API_KEY"] ?? "").isEmpty
        isSendingEnabled = environment["AGENT_SERVER_PANEL_ENABLED"] != "false"
    }

    public var hasRequiredCredentials: Bool { hasURL && hasAPIKey }
}
