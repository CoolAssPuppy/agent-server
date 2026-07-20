import Foundation

public enum AgentRuntimeChoice: String, CaseIterable, Identifiable, Sendable {
    case claudeCode
    case codex
    case kimiCode
    case kimiK3
    case custom

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .claudeCode: "Claude Code"
        case .codex: "Codex"
        case .kimiCode: "Kimi Code"
        case .kimiK3: "Kimi K3 via Moonshot"
        case .custom: "Custom model…"
        }
    }
}

public struct AgentRuntimeDraft: Equatable, Sendable {
    public var choice: AgentRuntimeChoice
    public var customEndpoint: String
    public var customModel: String
    public var customKeyVariable: String

    public init() {
        choice = .claudeCode
        customEndpoint = ""
        customModel = ""
        customKeyVariable = ""
    }

    public init(
        executor: String?,
        model: String?,
        providerEndpoint: String?,
        providerKeyReference: String?
    ) {
        customEndpoint = providerEndpoint ?? ""
        customModel = model ?? ""
        customKeyVariable = Self.variableName(from: providerKeyReference)

        if providerEndpoint != nil {
            choice = KimiModelPreset.matches(model: model, endpoint: providerEndpoint)
                ? .kimiK3
                : .custom
        } else if executor == "kimi-code" {
            choice = .kimiCode
        } else if executor == "codex" {
            choice = .codex
        } else {
            choice = .claudeCode
        }
    }

    public var resolvedExecutor: String? {
        switch choice {
        case .claudeCode: nil
        case .codex, .kimiK3, .custom: "codex"
        case .kimiCode: "kimi-code"
        }
    }

    public var resolvedModel: String? {
        switch choice {
        case .claudeCode, .codex, .kimiCode: nil
        case .kimiK3: KimiModelPreset.model
        case .custom: trimmed(customModel)
        }
    }

    public var resolvedProviderEndpoint: String? {
        switch choice {
        case .claudeCode, .codex, .kimiCode: nil
        case .kimiK3: KimiModelPreset.endpoint
        case .custom: trimmed(customEndpoint)
        }
    }

    public var resolvedProviderKeyReference: String? {
        switch choice {
        case .claudeCode, .codex, .kimiCode:
            return nil
        case .kimiK3:
            return KimiModelPreset.keyReference
        case .custom:
            guard let variable = trimmed(customKeyVariable) else { return nil }
            return "${\(variable)}"
        }
    }

    public var isValid: Bool {
        choice != .custom || trimmed(customEndpoint) != nil
    }

    public var keyVariableHint: String? {
        switch choice {
        case .kimiK3: KimiModelPreset.keyVariable
        case .custom: trimmed(customKeyVariable)
        case .claudeCode, .codex, .kimiCode: nil
        }
    }

    private static func variableName(from reference: String?) -> String {
        guard let reference else { return "" }
        if reference.hasPrefix("${"), reference.hasSuffix("}") {
            return String(reference.dropFirst(2).dropLast())
        }
        return reference
    }

    private func trimmed(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : value
    }
}
