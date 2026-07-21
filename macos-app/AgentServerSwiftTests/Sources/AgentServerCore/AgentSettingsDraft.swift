import Foundation

public struct AgentSettingsSnapshot: Equatable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let prompt: String
    public let enabled: Bool
    public let schedule: String?
    public let executor: String?
    public let model: String?
    public let provider: AgentSettingsProvider?
    public let capabilities: [String: Bool]

    public init(
        id: String,
        name: String,
        description: String?,
        prompt: String,
        enabled: Bool,
        schedule: String?,
        executor: String?,
        model: String?,
        provider: AgentSettingsProvider?,
        capabilities: [String: Bool]
    ) {
        self.id = id
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
}

public enum AgentSettingsValidationError: Equatable, Sendable {
    case nameRequired
    case providerEndpointRequired
}

public enum AgentSettingsValidation: Equatable, Sendable {
    case valid
    case invalid(AgentSettingsValidationError)
}

public struct AgentSettingsDraft: Equatable, Sendable {
    private let snapshot: AgentSettingsSnapshot
    private let initialRuntime: AgentRuntimeDraft
    private let initialSchedule: ScheduleDraft
    private var capabilityDraft: AgentCapabilityDraft

    public var name: String
    public var descriptionText: String
    public var promptText: String
    public var enabled: Bool
    public var schedule: ScheduleDraft
    public var runtime: AgentRuntimeDraft
    public var sourceAgentId: String { snapshot.id }

    public init(snapshot: AgentSettingsSnapshot) {
        self.snapshot = snapshot
        name = snapshot.name
        descriptionText = snapshot.description ?? ""
        promptText = snapshot.prompt
        enabled = snapshot.enabled
        let schedule = ScheduleDraft(cron: snapshot.schedule)
        self.schedule = schedule
        initialSchedule = schedule
        let runtime = AgentRuntimeDraft(
            executor: snapshot.executor,
            model: snapshot.model,
            providerEndpoint: snapshot.provider?.endpoint,
            providerKeyReference: snapshot.provider?.keyReference
        )
        self.runtime = runtime
        initialRuntime = runtime
        capabilityDraft = AgentCapabilityDraft(initialValues: snapshot.capabilities)
    }

    public var validation: AgentSettingsValidation {
        if trimmed(name) == nil { return .invalid(.nameRequired) }
        if !runtime.isValid { return .invalid(.providerEndpointRequired) }
        return .valid
    }

    public var isValid: Bool { validation == .valid }
    public var isDirty: Bool { !patch.isEmpty }

    public func isCapabilityEnabled(_ id: String, fallback: Bool) -> Bool {
        capabilityDraft.isEnabled(id, fallback: fallback)
    }

    public mutating func setCapability(_ id: String, enabled: Bool) {
        capabilityDraft.set(id, enabled: enabled)
    }

    public var patch: AgentSettingsPatch {
        var result = AgentSettingsPatch()
        let normalizedName = trimmed(name)
        if name != snapshot.name, normalizedName != snapshot.name { result.name = normalizedName }

        let normalizedDescription = descriptionText.trimmingCharacters(in: .whitespaces)
        if descriptionText != (snapshot.description ?? ""), normalizedDescription != (snapshot.description ?? "") {
            result.description = normalizedDescription.isEmpty ? .clear : .set(normalizedDescription)
        }

        if schedule != initialSchedule, schedule.cronExpression != snapshot.schedule {
            result.schedule = schedule.cronExpression.map(AgentSettingsValue.set) ?? .clear
        }

        let normalizedPrompt = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        if promptText != snapshot.prompt, !normalizedPrompt.isEmpty { result.prompt = promptText }
        if enabled != snapshot.enabled { result.enabled = enabled }
        addRuntimeChanges(to: &result)
        result.capabilities = capabilityDraft.changes
        return result
    }

    private func addRuntimeChanges(to patch: inout AgentSettingsPatch) {
        guard runtime != initialRuntime, runtime.isValid else { return }
        patch.executor = change(runtime.resolvedExecutor, from: snapshot.executor)
        patch.model = change(runtime.resolvedModel, from: snapshot.model)
        let provider = runtime.resolvedProviderEndpoint.map {
            AgentSettingsProvider(endpoint: $0, keyReference: runtime.resolvedProviderKeyReference)
        }
        patch.provider = change(provider, from: snapshot.provider)
    }

    private func change<Value>(_ value: Value?, from original: Value?) -> AgentSettingsValue<Value>
    where Value: Equatable & Sendable {
        guard value != original else { return .unchanged }
        return value.map(AgentSettingsValue.set) ?? .clear
    }

    private func trimmed(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : value
    }
}
