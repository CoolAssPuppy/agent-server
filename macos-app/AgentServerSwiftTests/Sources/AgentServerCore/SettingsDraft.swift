public enum SettingsDraftError: Error, Equatable {
    case invalidKey(String)
    case duplicateKey(String)
}

public enum AgentPanelConnection: String, Equatable, Sendable {
    case notSetUp = "Not set up"
    case off = "Off"
    case connected = "Connected"
    case reconnecting = "Reconnecting"
}

public struct SettingsDraft: Equatable {
    public static let catchUpKey = "AGENT_SERVER_CATCH_UP"
    public static let useInstalledClaudeKey = "AGENT_SERVER_USE_INSTALLED_CLAUDE"
    public static let useInstalledCodexKey = "AGENT_SERVER_USE_INSTALLED_CODEX"
    public static let useInstalledKimiKey = "AGENT_SERVER_USE_INSTALLED_KIMI"

    public var pairs: [EnvPair]
    public private(set) var telemetryProgress: TelemetryProgressSettings
    public private(set) var saveError: String?
    public private(set) var reloadGeneration = 0

    private var savedResumeAfterWake: Bool
    private var savedRuntimeSelection: RuntimeSelection
    private var savedPanelSendingEnabled: Bool
    private var savedTelemetryProgress: TelemetryProgressSettings

    public init(pairs: [EnvPair] = []) {
        self.pairs = pairs
        let telemetry = TelemetryProgressSettings(environment: pairs)
        telemetryProgress = telemetry
        savedTelemetryProgress = telemetry
        savedResumeAfterWake = Self.catchUpPreference.value(in: pairs)
        savedRuntimeSelection = Self.runtimeSelection(in: pairs)
        savedPanelSendingEnabled = Self.panelSettings(in: pairs).isSendingEnabled
    }

    public var invalidKeys: Set<String> {
        let invalid = pairs.filter { !EnvFileStore.isValidKey($0.key) }.map(\.key)
        let duplicates = Dictionary(grouping: pairs, by: \.key)
            .filter { !$0.key.isEmpty && $0.value.count > 1 }
            .map(\.key)
        return Set(invalid + duplicates)
    }

    public var resumeAfterWake: Bool {
        Self.catchUpPreference.value(in: pairs)
    }

    public var runtimeSelection: RuntimeSelection {
        Self.runtimeSelection(in: pairs)
    }

    public var requiresGeneralRestart: Bool {
        resumeAfterWake != savedResumeAfterWake
    }

    public var requiresRuntimeRestart: Bool {
        runtimeSelection.requiresRestart(comparedTo: savedRuntimeSelection)
    }

    public var requiresPanelRestart: Bool {
        panelSettings.isSendingEnabled != savedPanelSendingEnabled
            || telemetryProgress != savedTelemetryProgress
    }

    public var panelSettings: AgentPanelSettings {
        Self.panelSettings(in: pairs)
    }

    public mutating func setResumeAfterWake(_ isEnabled: Bool) {
        pairs = Self.catchUpPreference.updating(pairs, to: isEnabled)
    }

    public mutating func setRuntimeSelection(_ selection: RuntimeSelection) {
        pairs = Self.installedClaudePreference.updating(
            pairs,
            to: selection.usesInstalledClaude
        )
        pairs = Self.installedCodexPreference.updating(
            pairs,
            to: selection.usesInstalledCodex
        )
        pairs = Self.installedKimiPreference.updating(
            pairs,
            to: selection.usesInstalledKimi
        )
    }

    @discardableResult
    public mutating func setPanelSendingEnabled(_ isEnabled: Bool) -> Bool {
        guard !isEnabled || panelSettings.hasRequiredCredentials else { return false }
        pairs = Self.panelEnabledPreference.updating(pairs, to: isEnabled)
        return true
    }

    public func panelConnection(isServerReachable: Bool) -> AgentPanelConnection {
        guard panelSettings.hasRequiredCredentials else { return .notSetUp }
        guard panelSettings.isSendingEnabled else { return .off }
        return isServerReachable ? .connected : .reconnecting
    }

    public mutating func setTelemetryProgress(_ settings: TelemetryProgressSettings) {
        telemetryProgress = settings
        pairs = settings.applying(to: pairs)
    }

    public func validatedPairs() throws -> [EnvPair] {
        if let invalid = pairs.first(where: { !EnvFileStore.isValidKey($0.key) }) {
            throw SettingsDraftError.invalidKey(invalid.key)
        }
        var seen: Set<String> = []
        for pair in pairs where !seen.insert(pair.key).inserted {
            throw SettingsDraftError.duplicateKey(pair.key)
        }
        return pairs.filter { !$0.key.isEmpty }
    }

    public mutating func recordLoadFailure(fileName: String, description: String) {
        saveError = "Could not load \(fileName): \(description)"
    }

    public mutating func recordSaveFailure(_ error: EnvFileStoreError) {
        switch error {
        case .invalidKey(let key): saveError = "Invalid key: \(key)"
        case .duplicateKey(let key): saveError = "Duplicate key: \(key)"
        case .writeFailed(let message): saveError = "Could not save .env: \(message)"
        }
    }

    public mutating func recordValidationFailure(_ error: SettingsDraftError) {
        switch error {
        case .invalidKey(let key): saveError = "Invalid key: \(key)"
        case .duplicateKey(let key): saveError = "Duplicate key: \(key)"
        }
    }

    public mutating func recordSaveFailure(description: String) {
        saveError = "Could not save .env: \(description)"
    }

    public mutating func recordSaveSuccess() {
        saveError = nil
    }

    public mutating func acknowledgeGeneralRestart() {
        savedResumeAfterWake = resumeAfterWake
    }

    public mutating func acknowledgeRuntimeRestart() {
        savedRuntimeSelection = runtimeSelection
    }

    public mutating func acknowledgePanelRestart() {
        savedPanelSendingEnabled = panelSettings.isSendingEnabled
        savedTelemetryProgress = telemetryProgress
    }

    @discardableResult
    public mutating func beginWorkspaceReload() -> Int {
        reloadGeneration += 1
        replaceLoadedPairs([])
        return reloadGeneration
    }

    @discardableResult
    public mutating func applyReloadedPairs(_ pairs: [EnvPair], generation: Int) -> Bool {
        guard generation == reloadGeneration else { return false }
        replaceLoadedPairs(pairs)
        return true
    }

    public func acceptsWorkspaceReload(generation: Int) -> Bool {
        generation == reloadGeneration
    }

    public mutating func replaceLoadedPairs(_ pairs: [EnvPair]) {
        self.pairs = pairs
        telemetryProgress = TelemetryProgressSettings(environment: pairs)
        savedResumeAfterWake = resumeAfterWake
        savedRuntimeSelection = runtimeSelection
        savedPanelSendingEnabled = panelSettings.isSendingEnabled
        savedTelemetryProgress = telemetryProgress
        saveError = nil
    }

    private static func panelSettings(in pairs: [EnvPair]) -> AgentPanelSettings {
        AgentPanelSettings(environment: environmentLookup(pairs))
    }

    private static func environmentLookup(_ pairs: [EnvPair]) -> [String: String] {
        pairs.reduce(into: [:]) { result, pair in
            result[pair.key] = pair.value
        }
    }

    private static func runtimeSelection(in pairs: [EnvPair]) -> RuntimeSelection {
        RuntimeSelection(
            usesInstalledClaude: installedClaudePreference.value(in: pairs),
            usesInstalledCodex: installedCodexPreference.value(in: pairs),
            usesInstalledKimi: installedKimiPreference.value(in: pairs)
        )
    }

    private static let catchUpPreference = EnvironmentBooleanPreference(
        key: catchUpKey,
        defaultValue: true
    )
    private static let installedClaudePreference = EnvironmentBooleanPreference(
        key: useInstalledClaudeKey,
        defaultValue: true
    )
    private static let installedCodexPreference = EnvironmentBooleanPreference(
        key: useInstalledCodexKey,
        defaultValue: true
    )
    private static let installedKimiPreference = EnvironmentBooleanPreference(
        key: useInstalledKimiKey,
        defaultValue: true
    )
    private static let panelEnabledPreference = EnvironmentBooleanPreference(
        key: "AGENT_SERVER_PANEL_ENABLED",
        defaultValue: true
    )
}
