import Foundation

public enum AgentEnabledFileEditorError: LocalizedError, Equatable {
    case malformedFrontmatter
    case ambiguousEnabledValue
    case invalidEnabledValue

    public var errorDescription: String? {
        switch self {
        case .malformedFrontmatter:
            return "The agent definition has malformed frontmatter."
        case .ambiguousEnabledValue:
            return "The agent definition contains more than one enabled value."
        case .invalidEnabledValue:
            return "The agent definition has an invalid enabled value."
        }
    }
}

/// Updates an agent's top-level YAML `enabled` scalar without serializing the
/// document. All bytes outside the boolean token remain unchanged.
public enum AgentEnabledFileEditor {
    public static func enabled(in source: String) throws -> Bool {
        let documentRange = NSRange(source.startIndex..<source.endIndex, in: source)
        let metadataRange = try frontmatterRange(in: source, documentRange: documentRange)
        let declarations = matches(for: declarationPattern, in: source, range: metadataRange)
        guard declarations.count <= 1 else {
            throw AgentEnabledFileEditorError.ambiguousEnabledValue
        }
        let values = matches(for: valuePattern, in: source, range: metadataRange)
        if declarations.count == 1 && values.isEmpty {
            throw AgentEnabledFileEditorError.invalidEnabledValue
        }
        guard let match = values.first else { return true }
        let valueRange = match.range(at: 1)
        return (source as NSString).substring(with: valueRange).lowercased() == "true"
    }

    public static func updatingEnabled(in source: String, to value: Bool) throws -> String {
        let documentRange = NSRange(source.startIndex..<source.endIndex, in: source)
        let metadataRange = try frontmatterRange(in: source, documentRange: documentRange)
        let declarations = matches(for: declarationPattern, in: source, range: metadataRange)
        guard declarations.count <= 1 else {
            throw AgentEnabledFileEditorError.ambiguousEnabledValue
        }

        let values = matches(for: valuePattern, in: source, range: metadataRange)
        if declarations.count == 1 && values.isEmpty {
            throw AgentEnabledFileEditorError.invalidEnabledValue
        }
        guard values.count <= 1 else {
            throw AgentEnabledFileEditorError.ambiguousEnabledValue
        }

        if let match = values.first {
            let valueRange = match.range(at: 1)
            let current = (source as NSString).substring(with: valueRange).lowercased() == "true"
            guard current != value else { return source }
            return (source as NSString).replacingCharacters(
                in: valueRange,
                with: value ? "true" : "false"
            )
        }

        return insertEnabled(in: source, metadataRange: metadataRange, value: value)
    }

    /// Reads the latest file contents, transforms them, and atomically replaces
    /// only the requested file. The file is left untouched when validation fails.
    @discardableResult
    public static func setEnabled(at url: URL, to value: Bool) throws -> String {
        let source = try String(contentsOf: url, encoding: .utf8)
        let updated = try updatingEnabled(in: source, to: value)
        guard updated != source else { return source }
        guard let data = updated.data(using: .utf8) else {
            throw CocoaError(.fileWriteInapplicableStringEncoding)
        }
        try data.write(to: url, options: .atomic)
        return updated
    }

    private static let declarationPattern = try! NSRegularExpression(
        pattern: #"^enabled[\t ]*:"#,
        options: [.anchorsMatchLines, .caseInsensitive]
    )

    private static let valuePattern = try! NSRegularExpression(
        pattern: #"^enabled[\t ]*:[\t ]*(true|false)(?=[\t ]*(?:#.*)?\r?$)"#,
        options: [.anchorsMatchLines, .caseInsensitive]
    )

    private static let openerPattern = try! NSRegularExpression(pattern: #"\A---\r?\n"#)
    private static let closerPattern = try! NSRegularExpression(
        pattern: #"^---[\t ]*(?:\r?\n|\z)"#,
        options: [.anchorsMatchLines]
    )

    private static func frontmatterRange(in source: String, documentRange: NSRange) throws -> NSRange {
        guard let opener = openerPattern.firstMatch(in: source, range: documentRange) else {
            if source.hasPrefix("---") {
                throw AgentEnabledFileEditorError.malformedFrontmatter
            }
            return documentRange
        }
        let searchRange = NSRange(
            location: NSMaxRange(opener.range),
            length: documentRange.length - NSMaxRange(opener.range)
        )
        guard let closer = closerPattern.firstMatch(in: source, range: searchRange) else {
            throw AgentEnabledFileEditorError.malformedFrontmatter
        }
        return NSRange(location: NSMaxRange(opener.range), length: closer.range.location - NSMaxRange(opener.range))
    }

    private static func matches(
        for expression: NSRegularExpression,
        in source: String,
        range: NSRange
    ) -> [NSTextCheckingResult] {
        expression.matches(in: source, range: range)
    }

    private static func insertEnabled(in source: String, metadataRange: NSRange, value: Bool) -> String {
        let lineEnding = source.contains("\r\n") ? "\r\n" : "\n"
        let insertionLocation = NSMaxRange(metadataRange)
        let prefix = (source as NSString).substring(to: insertionLocation)
        let needsLeadingNewline = !prefix.isEmpty && !prefix.hasSuffix("\n")
        let insertion = (needsLeadingNewline ? lineEnding : "")
            + "enabled: \(value)"
            + lineEnding
        return (source as NSString).replacingCharacters(
            in: NSRange(location: insertionLocation, length: 0),
            with: insertion
        )
    }
}
