import Foundation

// MARK: - EnvPair

/// A single `KEY=value` pair from a `.env` file. `isSecret` is derived from
/// the key (ends with `_KEY`, `_SECRET`, or `_TOKEN`) so UI can decide whether
/// to mask the value on render.
public struct EnvPair: Equatable {
    public let key: String
    public let value: String
    public let isSecret: Bool

    public init(key: String, value: String, isSecret: Bool) {
        self.key = key
        self.value = value
        self.isSecret = isSecret
    }

    public init(key: String, value: String) {
        self.init(key: key, value: value, isSecret: EnvFileStore.isSecretKey(key))
    }
}

// MARK: - Errors

public enum EnvFileStoreError: Error, Equatable {
    case invalidKey(String)
    case writeFailed(String)
}

public enum LocalAPIAuthenticationError: Error, Equatable {
    case missingAPIKey
}

/// Adds the local API credential to a request without placing it in the URL,
/// logs, or a public client property. Shared by HTTP and WebSocket clients.
public enum LocalAPIAuthentication {
    public static func defaultEnvironmentURLs(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> [URL] {
        EnvFileStore.defaultURLs(homeDirectory: homeDirectory)
    }

    public static func authenticatedRequest(
        _ request: URLRequest,
        environmentURLs: [URL] = defaultEnvironmentURLs(),
        processEnvironment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URLRequest {
        let apiKey = try processEnvironment["AGENT_SERVER_API_KEY"]
            ?? EnvFileStore.firstValue(forKey: "AGENT_SERVER_API_KEY", from: environmentURLs)
        guard let apiKey, !apiKey.isEmpty else {
            throw LocalAPIAuthenticationError.missingAPIKey
        }

        var authenticated = request
        authenticated.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        return authenticated
    }

    /// Convenience overload for an explicitly injected environment file.
    public static func authenticatedRequest(
        _ request: URLRequest,
        environmentURL: URL
    ) throws -> URLRequest {
        try authenticatedRequest(request, environmentURLs: [environmentURL])
    }
}

// MARK: - EnvFileStore

/// Atomic reader/writer for a `.env` file. Preserves comments, blank lines,
/// and ordering of existing keys; appends brand-new keys to the end.
/// Save is atomic (write to sibling `.tmp` then `FileManager.replaceItemAt`).
public enum EnvFileStore {

    private static let keyPattern = #"^[A-Z][A-Z0-9_]*$"#
    private static let secretSuffixes = ["_KEY", "_SECRET", "_TOKEN"]

    public static func defaultURLs(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> [URL] {
        let baseDirectory = homeDirectory.appendingPathComponent(".agent-server")
        return [
            baseDirectory.appendingPathComponent(".env.local"),
            baseDirectory.appendingPathComponent(".env")
        ]
    }

    // MARK: Validation

    public static func isValidKey(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return key.range(of: keyPattern, options: .regularExpression) != nil
    }

    // MARK: Secret detection

    /// Matches keys that end with `_KEY`, `_SECRET`, or `_TOKEN`. Does NOT
    /// match generic substrings (`KEY_PATH`) or lowercased keys.
    public static func isSecretKey(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        guard key.range(of: keyPattern, options: .regularExpression) != nil else { return false }
        return secretSuffixes.contains(where: { key.hasSuffix($0) })
    }

    /// Returns `••••` followed by the last four characters of `value`. Values
    /// shorter than or equal to four characters pass through unchanged so the
    /// user does not see a mask that exposes the entire secret.
    public static func masked(value: String) -> String {
        guard value.count > 4 else { return value }
        return "••••\(value.suffix(4))"
    }

    // MARK: Load

    public static func load(from url: URL) throws -> [EnvPair] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let content = try String(contentsOf: url, encoding: .utf8)
        return parsePairs(from: content)
    }

    /// Reads one named value without returning unrelated secrets to the caller.
    public static func value(forKey key: String, from url: URL) throws -> String? {
        let value = try load(from: url).first(where: { $0.key == key })?.value
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// Returns the first non-empty value using the supplied file order.
    /// Callers pass `.env.local` before `.env` to match the server's precedence.
    public static func firstValue(forKey key: String, from urls: [URL]) throws -> String? {
        for url in urls {
            if let value = try value(forKey: key, from: url) {
                return value
            }
        }
        return nil
    }

    private static func parsePairs(from content: String) -> [EnvPair] {
        var pairs: [EnvPair] = []
        for rawLine in content.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#") { continue }
            guard let equalsIndex = line.firstIndex(of: "=") else { continue }
            let key = String(line[line.startIndex..<equalsIndex])
                .trimmingCharacters(in: .whitespaces)
            var value = String(line[line.index(after: equalsIndex)...])
                .trimmingCharacters(in: .whitespaces)
            if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
               (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            pairs.append(EnvPair(key: key, value: value, isSecret: isSecretKey(key)))
        }
        return pairs
    }

    // MARK: Save

    /// Atomically writes `pairs` to `url`, preserving comments and blank lines
    /// that already exist in the file. Existing keys retain their original
    /// position; brand-new keys append to the end. Rejects any invalid key.
    public static func save(_ pairs: [EnvPair], to url: URL) throws {
        for pair in pairs {
            guard isValidKey(pair.key) else {
                throw EnvFileStoreError.invalidKey(pair.key)
            }
        }

        let existingLines: [String] = {
            guard let content = try? String(contentsOf: url, encoding: .utf8) else { return [] }
            return content.components(separatedBy: .newlines)
        }()

        let rendered = renderLines(pairs: pairs, existingLines: existingLines)
        let output = rendered.joined(separator: "\n") + "\n"

        try writeAtomically(output, to: url)
    }

    /// Merges `pairs` onto the existing line structure:
    ///  - Comments and blank lines pass through in place.
    ///  - Existing `KEY=...` lines get rewritten with the new value if the key
    ///    is still present in `pairs`; otherwise they are dropped.
    ///  - Keys in `pairs` that weren't present before append at the end.
    private static func renderLines(
        pairs: [EnvPair],
        existingLines: [String]
    ) -> [String] {
        let pairsByKey: [String: EnvPair] = Dictionary(
            uniqueKeysWithValues: pairs.map { ($0.key, $0) }
        )
        var emitted: Set<String> = []
        var result: [String] = []

        for raw in existingLines {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                result.append("")
                continue
            }
            if trimmed.hasPrefix("#") {
                result.append(raw)
                continue
            }
            guard let equalsIndex = trimmed.firstIndex(of: "=") else {
                result.append(raw)
                continue
            }
            let key = String(trimmed[trimmed.startIndex..<equalsIndex])
                .trimmingCharacters(in: .whitespaces)
            if let pair = pairsByKey[key] {
                result.append("\(pair.key)=\(encode(pair.value))")
                emitted.insert(pair.key)
            }
        }

        // Drop any trailing empty string left over from a terminating newline
        // so we don't accumulate blank lines across round-trips.
        while let last = result.last, last.isEmpty {
            result.removeLast()
        }

        for pair in pairs where !emitted.contains(pair.key) {
            result.append("\(pair.key)=\(encode(pair.value))")
        }

        return result
    }

    private static func encode(_ value: String) -> String {
        if value.contains(" ") || value.contains("#") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return value
    }

    private static func writeAtomically(_ content: String, to url: URL) throws {
        let parent = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parent,
            withIntermediateDirectories: true
        )
        let tmpURL = parent.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        do {
            try content.write(to: tmpURL, atomically: true, encoding: .utf8)
        } catch {
            throw EnvFileStoreError.writeFailed(error.localizedDescription)
        }
        do {
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try FileManager.default.replaceItemAt(url, withItemAt: tmpURL)
            } else {
                try FileManager.default.moveItem(at: tmpURL, to: url)
            }
        } catch {
            try? FileManager.default.removeItem(at: tmpURL)
            throw EnvFileStoreError.writeFailed(error.localizedDescription)
        }
        // Lock to owner-only. .env holds API keys and tokens; default umask
        // would otherwise leave it world-readable on some setups.
        try? FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o600))],
            ofItemAtPath: url.path
        )
    }
}
