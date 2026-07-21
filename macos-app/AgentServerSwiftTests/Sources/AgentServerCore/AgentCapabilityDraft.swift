public enum AgentSettingsSaveFeedback: Equatable, Sendable {
    case saved
    case noChanges

    public var message: String {
        switch self {
        case .saved: "Saved"
        case .noChanges: "No changes to save"
        }
    }

    public var systemImage: String {
        switch self {
        case .saved: "checkmark.circle.fill"
        case .noChanges: "minus.circle"
        }
    }
}

public enum AgentSettingsSavePresentation {
    public static func shouldDismissAfterSave(isEmbedded: Bool) -> Bool {
        !isEmbedded
    }

    public static func showsActions(isDirty: Bool) -> Bool {
        isDirty
    }
}

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

public enum AgentSettingsContainerStyle: Equatable, Sendable {
    case nativeForm
}

public enum AgentSettingsSection: Equatable, Sendable {
    case basics
    case model
    case instructions
    case capabilities
    case delete
}

public enum AgentSettingsCapabilityRowStyle: Equatable, Sendable {
    case plain
}

public enum AgentSettingsCustomIndicator: Equatable, Sendable {
    case secondaryText
}

public enum AgentSettingsRawFileActionPlacement: Equatable, Sendable {
    case instructionsHeaderTrailing
}

public enum AgentSettingsDescriptionFieldStyle: Equatable, Sendable {
    case multilineFullWidth
}

public struct AgentSettingsSupportingSurfacePresentation: Equatable, Sendable {
    public let containerStyle = AgentSettingsContainerStyle.nativeForm
    public let sections: [AgentSettingsSection] = [
        .basics, .model, .instructions, .capabilities, .delete,
    ]
    public let capabilityRowStyle = AgentSettingsCapabilityRowStyle.plain
    public let customCapabilityIndicator = AgentSettingsCustomIndicator.secondaryText
    public let descriptionFieldStyle = AgentSettingsDescriptionFieldStyle.multilineFullWidth
    public let usesUniformFieldLabelTypography = true
    public let preservesNativeScheduleControlAlignment = true
    public let showsRedundantScheduleSummary = false
    public let showsStandardRuntimeHint = false
    public let rawFileActionPlacement = AgentSettingsRawFileActionPlacement.instructionsHeaderTrailing
    public let capabilityFooter: String? = nil
    public let areErrorsSelectable = true

    public init() {}
}
