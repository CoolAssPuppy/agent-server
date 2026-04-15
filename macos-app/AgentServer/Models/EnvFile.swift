import Foundation

struct EnvEntry: Identifiable {
    let id = UUID()
    var key: String
    var value: String
    var isComment: Bool

    static let readOnlyKeys: Set<String> = [
        "AGENT_SERVER_PORT",
    ]

    static let hiddenKeys: Set<String> = [
        "AGENT_SERVER_CATCH_UP",
    ]

    private static let sensitivePatterns = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"]

    var isSensitive: Bool {
        let upper = key.uppercased()
        return Self.sensitivePatterns.contains(where: { upper.contains($0) })
    }

    var isHidden: Bool {
        Self.hiddenKeys.contains(key)
    }

    var isURL: Bool {
        key == "AGENT_SERVER_PANEL_URL"
    }

    var isReadOnly: Bool {
        Self.readOnlyKeys.contains(key)
    }
}

struct EnvFile {
    var entries: [EnvEntry]

    static let defaultPath: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.agent-server/.env"
    }()

    static func load(from path: String = EnvFile.defaultPath) -> EnvFile {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            return EnvFile(entries: [])
        }
        return parse(content)
    }

    static func parse(_ content: String) -> EnvFile {
        let lines = content.components(separatedBy: .newlines)
        var entries: [EnvEntry] = []

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty { continue }

            if trimmed.hasPrefix("#") {
                entries.append(EnvEntry(key: trimmed, value: "", isComment: true))
                continue
            }

            guard let equalsIndex = trimmed.firstIndex(of: "=") else {
                entries.append(EnvEntry(key: trimmed, value: "", isComment: true))
                continue
            }

            let key = String(trimmed[trimmed.startIndex..<equalsIndex])
                .trimmingCharacters(in: .whitespaces)
            var value = String(trimmed[trimmed.index(after: equalsIndex)...])
                .trimmingCharacters(in: .whitespaces)

            if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
               (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }

            entries.append(EnvEntry(key: key, value: value, isComment: false))
        }

        return EnvFile(entries: entries)
    }

    func serialize() -> String {
        entries.map { entry in
            if entry.isComment { return entry.key }
            let needsQuotes = entry.value.contains(" ") || entry.value.contains("#")
            let value = needsQuotes ? "\"\(entry.value)\"" : entry.value
            return "\(entry.key)=\(value)"
        }.joined(separator: "\n") + "\n"
    }

    func save(to path: String = EnvFile.defaultPath) throws {
        let content = serialize()
        try content.write(toFile: path, atomically: true, encoding: .utf8)
        // Secrets live in .env. Restrict to owner read/write so other local
        // users can't read API keys or tokens. `.posixPermissions` uses an
        // NSNumber of an octal literal (0o600 = rw-------).
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o600))],
            ofItemAtPath: path
        )
    }
}
