import Foundation

enum MarkdownHighlightKind: Equatable {
    case frontmatterDelimiter
    case frontmatterValue
    case yamlKey
    case yamlBoolean
    case yamlNumber
    case yamlString
    case bullet
    case numberedList
    case heading(level: Int)
    case comment
    case codeFence
    case codeBlock
    case inlineCode
    case bold
}

struct MarkdownHighlightSpan: Equatable {
    let kind: MarkdownHighlightKind
    let range: NSRange

    func isValid(forUTF16Length utf16Length: Int) -> Bool {
        guard utf16Length >= 0,
              range.location >= 0,
              range.length >= 0,
              range.location <= utf16Length else {
            return false
        }
        return range.length <= utf16Length - range.location
    }
}

struct MarkdownLine: Equatable {
    let text: String
    let range: NSRange
}

enum MarkdownHighlightRanges {
    private static let bulletRegex = try? NSRegularExpression(
        pattern: #"^\s*([-*] )"#
    )
    private static let yamlBulletRegex = try? NSRegularExpression(
        pattern: #"^\s*(- )"#
    )
    private static let numberedListRegex = try? NSRegularExpression(
        pattern: #"^\s*(\d+\. )"#
    )
    private static let inlineCodeRegex = try? NSRegularExpression(
        pattern: #"`[^`]+`"#
    )
    private static let boldRegex = try? NSRegularExpression(
        pattern: #"\*\*[^*]+\*\*"#
    )

    static func lines(in text: String) -> [MarkdownLine] {
        let source = text as NSString
        var result: [MarkdownLine] = []
        var location = 0

        while location < source.length {
            var start = 0
            var end = 0
            var contentsEnd = 0
            source.getLineStart(
                &start,
                end: &end,
                contentsEnd: &contentsEnd,
                for: NSRange(location: location, length: 0)
            )
            let range = NSRange(location: start, length: contentsEnd - start)
            result.append(MarkdownLine(text: source.substring(with: range), range: range))
            location = end
        }

        return result
    }

    static func spans(in text: String) -> [MarkdownHighlightSpan] {
        var result: [MarkdownHighlightSpan] = []
        var isInFrontmatter = false
        var hasStartedFrontmatter = false
        var isInCodeBlock = false

        for line in lines(in: text) {
            let trimmed = line.text.trimmingCharacters(in: .whitespaces)

            if trimmed == "---" {
                if !hasStartedFrontmatter {
                    isInFrontmatter = true
                    hasStartedFrontmatter = true
                    result.append(span(.frontmatterDelimiter, line.range))
                } else if isInFrontmatter {
                    isInFrontmatter = false
                    result.append(span(.frontmatterDelimiter, line.range))
                }
                continue
            }

            if isInFrontmatter {
                result.append(contentsOf: frontmatterSpans(for: line))
                continue
            }

            if trimmed.hasPrefix("```") {
                isInCodeBlock.toggle()
                result.append(span(.codeFence, line.range))
                continue
            }

            if isInCodeBlock {
                result.append(span(.codeBlock, line.range))
                continue
            }

            if trimmed.hasPrefix("### ") {
                result.append(span(.heading(level: 3), line.range))
            } else if trimmed.hasPrefix("## ") {
                result.append(span(.heading(level: 2), line.range))
            } else if trimmed.hasPrefix("# ") {
                result.append(span(.heading(level: 1), line.range))
            } else if let marker = capturedRange(using: bulletRegex, in: line) {
                result.append(span(.bullet, marker))
            } else if let marker = capturedRange(using: numberedListRegex, in: line) {
                result.append(span(.numberedList, marker))
            } else if trimmed.hasPrefix("#") {
                result.append(span(.comment, line.range))
            }

            result.append(contentsOf: inlineSpans(for: line))
        }

        return result
    }

    private static func frontmatterSpans(for line: MarkdownLine) -> [MarkdownHighlightSpan] {
        let content = line.text as NSString
        var result = [span(.frontmatterValue, line.range)]
        let colon = content.range(of: ":")

        if colon.location != NSNotFound {
            let keyRange = NSRange(location: line.range.location, length: colon.location)
            result.append(span(.yamlKey, keyRange))

            let valueStart = NSMaxRange(colon)
            guard valueStart < content.length else { return result }
            let valueRange = NSRange(
                location: line.range.location + valueStart,
                length: content.length - valueStart
            )
            let value = content.substring(from: valueStart)
                .trimmingCharacters(in: .whitespaces)
            if value == "true" || value == "false" {
                result.append(span(.yamlBoolean, valueRange))
            } else if Int(value) != nil {
                result.append(span(.yamlNumber, valueRange))
            } else if value.hasPrefix("\"") || value.hasPrefix("'") {
                result.append(span(.yamlString, valueRange))
            }
            return result
        }

        guard let marker = capturedRange(using: yamlBulletRegex, in: line) else {
            return result
        }
        result.append(span(.bullet, marker))
        let itemStart = NSMaxRange(marker)
        if itemStart < NSMaxRange(line.range) {
            result.append(span(
                .yamlString,
                NSRange(location: itemStart, length: NSMaxRange(line.range) - itemStart)
            ))
        }
        return result
    }

    private static func inlineSpans(for line: MarkdownLine) -> [MarkdownHighlightSpan] {
        inlineMatches(regex: inlineCodeRegex, kind: .inlineCode, line: line)
            + inlineMatches(regex: boldRegex, kind: .bold, line: line)
    }

    private static func inlineMatches(
        regex: NSRegularExpression?,
        kind: MarkdownHighlightKind,
        line: MarkdownLine
    ) -> [MarkdownHighlightSpan] {
        guard let regex else { return [] }
        let length = (line.text as NSString).length
        return regex.matches(in: line.text, range: NSRange(location: 0, length: length)).map {
            span(
                kind,
                NSRange(
                    location: line.range.location + $0.range.location,
                    length: $0.range.length
                )
            )
        }
    }

    private static func capturedRange(
        using regex: NSRegularExpression?,
        in line: MarkdownLine
    ) -> NSRange? {
        guard let regex else { return nil }
        let utf16Length = (line.text as NSString).length
        guard let match = regex.firstMatch(
            in: line.text,
            range: NSRange(location: 0, length: utf16Length)
        ) else { return nil }
        let markerRange = match.range(at: 1)
        guard markerRange.location != NSNotFound else { return nil }
        return NSRange(
            location: line.range.location + markerRange.location,
            length: markerRange.length
        )
    }

    private static func span(
        _ kind: MarkdownHighlightKind,
        _ range: NSRange
    ) -> MarkdownHighlightSpan {
        MarkdownHighlightSpan(kind: kind, range: range)
    }
}
