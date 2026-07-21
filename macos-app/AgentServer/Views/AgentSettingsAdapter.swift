import Foundation

extension Agent {
    var settingsSnapshot: AgentSettingsSnapshot {
        AgentSettingsSnapshot(
            id: id,
            name: name,
            description: description,
            prompt: prompt,
            enabled: enabled,
            schedule: schedule,
            executor: executor,
            model: model,
            provider: provider.map {
                AgentSettingsProvider(endpoint: $0.baseURL, keyReference: $0.apiKey)
            },
            capabilities: (capabilities ?? []).reduce(into: [:]) { values, capability in
                values[capability.id] = capability.enabled
            }
        )
    }
}

@MainActor
extension StatusMonitor {
    func updateAgent(id: String, settingsPatch: AgentSettingsPatch) async -> AgentWriteOutcome {
        await updateAgent(id: id, patch: settingsPatch.jsonObject)
    }
}

private extension AgentSettingsPatch {
    var jsonObject: [String: Any] {
        var object: [String: Any] = [:]
        if let name { object["name"] = name }
        add(description, key: "description", to: &object)
        if let prompt { object["prompt"] = prompt }
        if let enabled { object["enabled"] = enabled }
        add(schedule, key: "schedule", to: &object)
        add(executor, key: "executor", to: &object)
        add(model, key: "model", to: &object)
        switch provider {
        case .unchanged: break
        case .clear: object["provider"] = NSNull()
        case .set(let provider):
            var value: [String: Any] = ["base_url": provider.endpoint]
            if let keyReference = provider.keyReference { value["api_key"] = keyReference }
            object["provider"] = value
        }
        if !capabilities.isEmpty {
            object["capabilities"] = capabilities.map { ["id": $0.id, "enabled": $0.enabled] }
        }
        return object
    }

    func add(_ value: AgentSettingsValue<String>, key: String, to object: inout [String: Any]) {
        switch value {
        case .unchanged: break
        case .set(let value): object[key] = value
        case .clear: object[key] = NSNull()
        }
    }
}
