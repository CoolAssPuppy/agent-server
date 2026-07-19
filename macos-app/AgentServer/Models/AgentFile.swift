import Foundation

struct AgentFile: Identifiable {
    let id: String
    let url: URL
    var content: String

    var filename: String {
        url.lastPathComponent
    }

    var isMarkdown: Bool {
        let ext = url.pathExtension.lowercased()
        return ext == "md" || ext == "markdown"
    }

    static var agentsDirectory: URL {
        AgentServerWorkspaceStore.current().agentsDirectory
    }

    static func loadAll() -> [AgentFile] {
        let dir = agentsDirectory.resolvingSymlinksInPath()
        let fm = FileManager.default

        guard let entries = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        let allowedExtensions: Set<String> = ["yaml", "yml", "md", "markdown"]

        return entries
            .filter { allowedExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }
            .compactMap { url in
                guard let content = try? String(contentsOf: url, encoding: .utf8) else { return nil }
                let agentId = extractId(from: content) ?? url.deletingPathExtension().lastPathComponent
                return AgentFile(id: agentId, url: url, content: content)
            }
    }

    static func find(agentId: String) -> AgentFile? {
        loadAll().first { $0.id == agentId }
    }

    func save() throws {
        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    static func create(filename: String, content: String) throws -> AgentFile {
        let dir = agentsDirectory
        let fm = FileManager.default

        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        let url = dir.appendingPathComponent(filename)

        if fm.fileExists(atPath: url.path) {
            throw AgentFileError.fileAlreadyExists(filename)
        }

        try content.write(to: url, atomically: true, encoding: .utf8)
        let agentId = extractId(from: content) ?? url.deletingPathExtension().lastPathComponent
        return AgentFile(id: agentId, url: url, content: content)
    }

    private static func extractId(from content: String) -> String? {
        for line in content.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("id:") {
                let value = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                let unquoted = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                if !unquoted.isEmpty { return unquoted }
            }
        }
        return nil
    }

    static let newAgentYAMLTemplate = """
    id: new-agent
    name: New Agent
    description: What this agent does
    # schedule: "0 9 * * 1-5"
    # timezone: America/New_York
    prompt: |
      Your prompt goes here.
      Describe what the agent should do.
    tools:
      - Read
      - Bash
    max_turns: 20
    enabled: false
    """

    static let newAgentMarkdownTemplate = """
    ---
    id: new-agent
    name: New Agent
    description: What this agent does
    # schedule: "0 9 * * 1-5"
    # timezone: America/New_York
    tools:
      - Read
      - Bash
    max_turns: 20
    enabled: false
    ---

    # New agent

    Your prompt goes here. Describe what the agent should do.

    ## Step 1

    First, do this.

    ## Step 2

    Then, do that.
    """
}

enum AgentFileError: LocalizedError {
    case fileAlreadyExists(String)

    var errorDescription: String? {
        switch self {
        case .fileAlreadyExists(let name):
            return "A file named \"\(name)\" already exists."
        }
    }
}
