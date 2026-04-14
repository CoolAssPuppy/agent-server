import Foundation

/// Parsed representation of an agent markdown file. Splits a YAML frontmatter
/// block (fenced by `---` on its own lines) from the prompt body beneath. The
/// frontmatter is preserved verbatim and is never exposed for editing.
public struct AgentPromptDocument: Equatable {
    public let frontmatter: String
    public let body: String

    public init(source: String) {
        let (fm, rest) = Self.split(source)
        self.frontmatter = fm
        self.body = rest
    }

    /// Reassemble the document with a new body, leaving the frontmatter exactly
    /// as it was read from disk.
    public func serialize(newBody: String) -> String {
        if frontmatter.isEmpty { return newBody }
        return frontmatter + newBody
    }

    // MARK: - Parsing

    private static func split(_ source: String) -> (String, String) {
        guard source.hasPrefix("---") else { return ("", source) }

        // Use a character-level scan so we preserve exact whitespace and line
        // endings in both halves.
        let lines = source.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            return ("", source)
        }

        for index in 1..<lines.count {
            if lines[index].trimmingCharacters(in: .whitespaces) == "---" {
                let fmLines = lines[0...index]
                let bodyLines = lines[(index + 1)...]
                let frontmatter = fmLines.joined(separator: "\n")
                let body = bodyLines.isEmpty ? "" : bodyLines.joined(separator: "\n")
                return (frontmatter, body)
            }
        }

        // No closing fence — treat entire document as body.
        return ("", source)
    }
}
