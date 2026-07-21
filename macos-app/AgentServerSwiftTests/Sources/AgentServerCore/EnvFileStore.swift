import Foundation

// MARK: - EnvPair

/// A single `KEY=value` pair from a `.env` file. `isSecret` is derived from a
/// conservative catalog of credential key names so UI can mask the value.
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

public enum EnvFileStoreError: LocalizedError, Equatable {
    case invalidKey(String)
    case duplicateKey(String)
    case writeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidKey(let key):
            return "Invalid environment key: \(key)"
        case .duplicateKey(let key):
            return "Duplicate environment key: \(key)"
        case .writeFailed(let message):
            return "Could not write the environment file: \(message)"
        }
    }
}

public enum LocalAPIAuthenticationError: Error, Equatable {
    case missingAPIKey
}

/// Adds the local API credential to a request without placing it in the URL,
/// logs, or a public client property. Shared by HTTP and WebSocket clients.
public enum LocalAPIAuthentication {
    public static func defaultEnvironmentURLs(
        homeDirectory: URL? = nil
    ) -> [URL] {
        if let homeDirectory {
            return EnvFileStore.defaultURLs(homeDirectory: homeDirectory)
        }
        return EnvFileStore.configuredURLs()
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
/// Save writes to an owner-only sibling temp file, verifies its permissions,
/// then atomically replaces the destination using the temp file's metadata.
public enum EnvFileStore {

    private static let keyPattern = #"^[A-Z][A-Z0-9_]*$"#
    private static let secretTerminalNames: Set<String> = [
        "AUTH",
        "AUTHORIZATION",
        "COOKIE",
        "CREDENTIAL",
        "CREDENTIALS",
        "KEY",
        "PASSCODE",
        "PASSPHRASE",
        "PASSWORD",
        "PASSWD",
        "SECRET",
        "TOKEN",
    ]

    public static func defaultURLs(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> [URL] {
        let baseDirectory = homeDirectory.appendingPathComponent(".agent-server")
        return [baseDirectory.appendingPathComponent(".env")]
    }

    public static func configuredURLs(defaults: UserDefaults = .standard) -> [URL] {
        [AgentServerWorkspaceStore.current(defaults: defaults).environmentFile]
    }

    // MARK: Validation

    public static func isValidKey(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return key.range(of: keyPattern, options: .regularExpression) != nil
    }

    // MARK: Secret detection

    /// Matches a conservative catalog of terminal credential names. Generic
    /// substrings and path/file variables remain visible.
    public static func isSecretKey(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        guard key.range(of: keyPattern, options: .regularExpression) != nil else { return false }
        guard key != "PUBLIC_KEY", !key.hasSuffix("_PUBLIC_KEY") else { return false }
        guard let terminalName = key.split(separator: "_").last else { return false }
        return secretTerminalNames.contains(String(terminalName))
    }

    /// Returns `••••` followed by the last four characters of `value`. Values
    /// shorter than or equal to four characters are fully masked.
    public static func masked(value: String) -> String {
        guard value.count > 4 else { return "••••" }
        return "••••\(value.suffix(4))"
    }

    // MARK: Load

    public static func load(from url: URL) throws -> [EnvPair] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let content = try String(contentsOf: url, encoding: .utf8)
        return try parsePairs(from: content)
    }

    /// Reads one named value without returning unrelated secrets to the caller.
    public static func value(forKey key: String, from url: URL) throws -> String? {
        let value = try load(from: url).first(where: { $0.key == key })?.value
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// Returns the first non-empty value using the supplied file order.
    public static func firstValue(forKey key: String, from urls: [URL]) throws -> String? {
        for url in urls {
            if let value = try value(forKey: key, from: url) {
                return value
            }
        }
        return nil
    }

    private static func parsePairs(from content: String) throws -> [EnvPair] {
        var pairs: [EnvPair] = []
        var seenKeys: Set<String> = []
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
            guard seenKeys.insert(key).inserted else {
                throw EnvFileStoreError.duplicateKey(key)
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
        try save(pairs, to: url, secureTemporaryFile: applySecurePermissions)
    }

    static func save(
        _ pairs: [EnvPair],
        to url: URL,
        secureTemporaryFile: (URL) throws -> Void
    ) throws {
        var seenKeys: Set<String> = []
        for pair in pairs {
            guard isValidKey(pair.key) else {
                throw EnvFileStoreError.invalidKey(pair.key)
            }
            guard seenKeys.insert(pair.key).inserted else {
                throw EnvFileStoreError.duplicateKey(pair.key)
            }
        }

        let existingLines: [String] = {
            guard let content = try? String(contentsOf: url, encoding: .utf8) else { return [] }
            return content.components(separatedBy: .newlines)
        }()

        let rendered = renderLines(pairs: pairs, existingLines: existingLines)
        let output = rendered.joined(separator: "\n") + "\n"

        try writeAtomically(output, to: url, secureTemporaryFile: secureTemporaryFile)
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

    private static func writeAtomically(
        _ content: String,
        to url: URL,
        secureTemporaryFile: (URL) throws -> Void
    ) throws {
        let parent = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parent,
            withIntermediateDirectories: true
        )
        let tmpURL = parent.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(
            atPath: tmpURL.path,
            contents: nil,
            attributes: [.posixPermissions: NSNumber(value: 0o600)]
        ) else {
            throw EnvFileStoreError.writeFailed("Could not create a temporary file.")
        }
        do {
            try secureTemporaryFile(tmpURL)
            let handle = try FileHandle(forWritingTo: tmpURL)
            do {
                try handle.write(contentsOf: Data(content.utf8))
                try handle.synchronize()
                try handle.close()
            } catch {
                try? handle.close()
                throw error
            }
            try secureTemporaryFile(tmpURL)
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try FileManager.default.replaceItemAt(
                    url,
                    withItemAt: tmpURL,
                    options: .usingNewMetadataOnly
                )
            } else {
                try FileManager.default.moveItem(at: tmpURL, to: url)
            }
        } catch let error as EnvFileStoreError {
            try? FileManager.default.removeItem(at: tmpURL)
            throw error
        } catch {
            try? FileManager.default.removeItem(at: tmpURL)
            throw EnvFileStoreError.writeFailed(error.localizedDescription)
        }
    }

    private static func applySecurePermissions(to url: URL) throws {
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o600))],
            ofItemAtPath: url.path
        )
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
        guard permissions == 0o600 else {
            throw EnvFileStoreError.writeFailed("Temporary file permissions are not owner-only.")
        }
    }
}
