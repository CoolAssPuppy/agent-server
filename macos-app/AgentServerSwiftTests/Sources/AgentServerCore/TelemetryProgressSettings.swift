public enum TelemetryProgressMode: String, Equatable, Sendable {
    case live
    case batched
}

public struct TelemetryProgressSettings: Equatable, Sendable {
    public static let modeKey = "AGENT_SERVER_TELEMETRY_PROGRESS_MODE"
    public static let sampleMillisecondsKey = "AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS"
    public static let maxEntriesKey = "AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES"
    public static let includesMetadataKey = "AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA"

    public static let `default` = TelemetryProgressSettings(
        mode: .live,
        sampleSeconds: 5,
        maxEntries: 50,
        includesMetadata: false
    )

    public var mode: TelemetryProgressMode
    public var sampleSeconds: Int
    public var maxEntries: Int
    public var includesMetadata: Bool

    public init(
        mode: TelemetryProgressMode,
        sampleSeconds: Int,
        maxEntries: Int,
        includesMetadata: Bool
    ) {
        self.mode = mode
        self.sampleSeconds = sampleSeconds.clamped(to: 1...600)
        self.maxEntries = maxEntries.clamped(to: 1...500)
        self.includesMetadata = includesMetadata
    }

    public init(environment pairs: [EnvPair]) {
        let environment = Self.environmentLookup(pairs)
        let defaults = Self.default
        let mode = environment[Self.modeKey]
            .flatMap(TelemetryProgressMode.init(rawValue:))
            ?? defaults.mode
        let sampleSeconds = environment[Self.sampleMillisecondsKey]
            .flatMap(Int.init)
            .map { ($0 / 1_000).clamped(to: 1...600) }
            ?? defaults.sampleSeconds
        let maxEntries = environment[Self.maxEntriesKey]
            .flatMap(Int.init)
            .map { $0.clamped(to: 1...500) }
            ?? defaults.maxEntries
        let includesMetadata = environment[Self.includesMetadataKey]
            .map { $0 == "true" }
            ?? defaults.includesMetadata

        self.init(
            mode: mode,
            sampleSeconds: sampleSeconds,
            maxEntries: maxEntries,
            includesMetadata: includesMetadata
        )
    }

    public func applying(to pairs: [EnvPair]) -> [EnvPair] {
        let values = [
            (Self.modeKey, mode.rawValue),
            (Self.sampleMillisecondsKey, String(sampleSeconds * 1_000)),
            (Self.maxEntriesKey, String(maxEntries)),
            (Self.includesMetadataKey, includesMetadata ? "true" : "false"),
        ]
        return values.reduce(pairs) { result, setting in
            result.replacingOrAppending(key: setting.0, value: setting.1)
        }
    }

    private static func environmentLookup(_ pairs: [EnvPair]) -> [String: String] {
        pairs.reduce(into: [:]) { result, pair in
            result[pair.key] = pair.value
        }
    }
}

private extension Int {
    func clamped(to range: ClosedRange<Int>) -> Int {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}

private extension Array where Element == EnvPair {
    func replacingOrAppending(key: String, value: String) -> [EnvPair] {
        let updated = EnvPair(key: key, value: value, isSecret: false)
        guard let index = firstIndex(where: { $0.key == key }) else {
            return self + [updated]
        }
        var result = self
        result[index] = updated
        return result
    }
}
