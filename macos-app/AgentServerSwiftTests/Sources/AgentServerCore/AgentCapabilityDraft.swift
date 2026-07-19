public struct AgentCapabilityChange: Equatable, Sendable {
    public let id: String
    public let enabled: Bool

    public init(id: String, enabled: Bool) {
        self.id = id
        self.enabled = enabled
    }
}

public struct AgentCapabilityDraft: Equatable, Sendable {
    private let initialValues: [String: Bool]
    private var overrides: [String: Bool] = [:]

    public init(initialValues: [String: Bool]) {
        self.initialValues = initialValues
    }

    public var changes: [AgentCapabilityChange] {
        overrides
            .map { AgentCapabilityChange(id: $0.key, enabled: $0.value) }
            .sorted { $0.id < $1.id }
    }

    public func isEnabled(_ id: String, fallback: Bool) -> Bool {
        overrides[id] ?? initialValues[id] ?? fallback
    }

    public mutating func set(_ id: String, enabled: Bool) {
        if initialValues[id] == enabled {
            overrides[id] = nil
        } else {
            overrides[id] = enabled
        }
    }
}
