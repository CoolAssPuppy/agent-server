public enum AgentSettingsValue<Value: Equatable & Sendable>: Equatable, Sendable {
    case unchanged
    case set(Value)
    case clear
}

public struct AgentSettingsProvider: Equatable, Sendable {
    public let endpoint: String
    public let keyReference: String?

    public init(endpoint: String, keyReference: String?) {
        self.endpoint = endpoint
        self.keyReference = keyReference
    }
}

public struct AgentSettingsPatch: Equatable, Sendable {
    public internal(set) var name: String?
    public internal(set) var description: AgentSettingsValue<String>
    public internal(set) var prompt: String?
    public internal(set) var enabled: Bool?
    public internal(set) var schedule: AgentSettingsValue<String>
    public internal(set) var executor: AgentSettingsValue<String>
    public internal(set) var model: AgentSettingsValue<String>
    public internal(set) var provider: AgentSettingsValue<AgentSettingsProvider>
    public internal(set) var capabilities: [AgentCapabilityChange]

    init(
        name: String? = nil,
        description: AgentSettingsValue<String> = .unchanged,
        prompt: String? = nil,
        enabled: Bool? = nil,
        schedule: AgentSettingsValue<String> = .unchanged,
        executor: AgentSettingsValue<String> = .unchanged,
        model: AgentSettingsValue<String> = .unchanged,
        provider: AgentSettingsValue<AgentSettingsProvider> = .unchanged,
        capabilities: [AgentCapabilityChange] = []
    ) {
        self.name = name
        self.description = description
        self.prompt = prompt
        self.enabled = enabled
        self.schedule = schedule
        self.executor = executor
        self.model = model
        self.provider = provider
        self.capabilities = capabilities
    }

    public var isEmpty: Bool {
        name == nil
            && description == .unchanged
            && prompt == nil
            && enabled == nil
            && schedule == .unchanged
            && executor == .unchanged
            && model == .unchanged
            && provider == .unchanged
            && capabilities.isEmpty
    }

    public var hasAgentFileChanges: Bool {
        name != nil
            || description != .unchanged
            || prompt != nil
            || enabled != nil
            || schedule != .unchanged
            || !capabilities.isEmpty
    }
}
