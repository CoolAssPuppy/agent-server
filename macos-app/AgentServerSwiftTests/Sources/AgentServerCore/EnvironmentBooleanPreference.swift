public struct EnvironmentBooleanPreference: Equatable, Sendable {
    public let key: String
    public let defaultValue: Bool

    public init(key: String, defaultValue: Bool) {
        self.key = key
        self.defaultValue = defaultValue
    }

    public func value(in pairs: [EnvPair]) -> Bool {
        guard let stored = pairs.first(where: { $0.key == key })?.value else {
            return defaultValue
        }
        return stored.lowercased() == "true"
    }

    public func updating(_ pairs: [EnvPair], to value: Bool) -> [EnvPair] {
        guard value != defaultValue else {
            return pairs.filter { $0.key != key }
        }

        let updated = EnvPair(key: key, value: String(value), isSecret: false)
        guard let index = pairs.firstIndex(where: { $0.key == key }) else {
            return pairs + [updated]
        }

        var result = pairs
        result[index] = updated
        return result
    }
}
