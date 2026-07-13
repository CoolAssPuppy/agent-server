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

        let fullRange = NSRange(source.startIndex..<source.endIndex, in: source)
        let opener = try! NSRegularExpression(pattern: #"\A---\r?\n"#)
        guard let openMatch = opener.firstMatch(in: source, range: fullRange) else {
            return ("", source)
        }
        let closer = try! NSRegularExpression(
            pattern: #"^---[\t ]*(?:\r?\n|\z)"#,
            options: [.anchorsMatchLines]
        )
        let remainingRange = NSRange(
            location: NSMaxRange(openMatch.range),
            length: fullRange.length - NSMaxRange(openMatch.range)
        )
        if let closeMatch = closer.firstMatch(in: source, range: remainingRange) {
            let boundary = NSMaxRange(closeMatch.range)
            let frontmatter = (source as NSString).substring(to: boundary)
            let body = (source as NSString).substring(from: boundary)
            return (frontmatter, body)
        }

        // No closing fence — treat entire document as body.
        return ("", source)
    }
}
