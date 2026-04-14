import Foundation

// MARK: - Entry

struct ConnectionEntry: Equatable, Identifiable {
    let id: UUID
    var key: String
    var value: String

    init(id: UUID = UUID(), key: String, value: String) {
        self.id = id
        self.key = key
        self.value = value
    }
}

// MARK: - Store

/// Governs the `~/.agent-server/connections.json` editor used in the Settings
/// drawer. Enforces the SCREAMING_SNAKE key regex, produces masked render
/// values for secret-like keys, and serializes to / from JSON.
final class ConnectionsStore: ObservableObject {
    @Published var entries: [ConnectionEntry]

    static let keyRegex = #"^[A-Z][A-Z0-9_]*$"#

    init(entries: [ConnectionEntry] = []) {
        self.entries = entries
    }

    // MARK: Validation

    static func isValidKey(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return key.range(of: Self.keyRegex, options: .regularExpression) != nil
    }

    var allKeysValid: Bool {
        entries.allSatisfy { Self.isValidKey($0.key) }
    }

    var hasRequiredPanelPair: Bool {
        let keys = Set(entries.map { $0.key })
        return keys.contains("AGENT_SERVER_PANEL_URL")
            && keys.contains("AGENT_SERVER_PANEL_API_KEY")
    }

    // MARK: Masking

    /// Keys ending in `_KEY`, `_SECRET`, or `_TOKEN` render as `••••last4`
    /// (or just the raw value when shorter than 5 chars).
    static func isSecretKey(_ key: String) -> Bool {
        key.hasSuffix("_KEY") || key.hasSuffix("_SECRET") || key.hasSuffix("_TOKEN")
    }

    static func maskedValue(key: String, value: String) -> String {
        guard isSecretKey(key) else { return value }
        guard value.count >= 5 else { return value }
        let last4 = String(value.suffix(4))
        return "••••\(last4)"
    }

    // MARK: Mutations

    func append(key: String = "", value: String = "") {
        entries.append(ConnectionEntry(key: key, value: value))
    }

    func remove(id: UUID) {
        entries.removeAll { $0.id == id }
    }

    // MARK: JSON roundtrip

    /// Serializes entries as `{ "KEY": "value", ... }`. Later duplicates win,
    /// matching standard JSON object semantics.
    func toJSONData() throws -> Data {
        var dict: [String: String] = [:]
        for entry in entries {
            dict[entry.key] = entry.value
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(dict)
    }

    static func from(jsonData: Data) throws -> ConnectionsStore {
        let dict = try JSONDecoder().decode([String: String].self, from: jsonData)
        let sortedKeys = dict.keys.sorted()
        let entries = sortedKeys.map { key in
            ConnectionEntry(key: key, value: dict[key] ?? "")
        }
        return ConnectionsStore(entries: entries)
    }
}
