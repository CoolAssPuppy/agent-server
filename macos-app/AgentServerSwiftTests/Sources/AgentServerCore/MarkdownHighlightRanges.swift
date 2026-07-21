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
}

struct MarkdownLine: Equatable {
    let text: String
    let range: NSRange
}

enum MarkdownHighlightRanges {
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
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                if let marker = markerRange(in: line, length: 2) {
                    result.append(span(.bullet, marker))
                }
            } else if isNumberedList(trimmed) {
                if let marker = numberedMarkerRange(in: line) {
                    result.append(span(.numberedList, marker))
                }
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

        let trimmed = line.text.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("- "),
              let marker = markerRange(in: line, length: 2) else {
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
        inlineMatches(pattern: #"`[^`]+`"#, kind: .inlineCode, line: line)
            + inlineMatches(pattern: #"\*\*[^*]+\*\*"#, kind: .bold, line: line)
    }

    private static func inlineMatches(
        pattern: String,
        kind: MarkdownHighlightKind,
        line: MarkdownLine
    ) -> [MarkdownHighlightSpan] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
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

    private static func markerRange(in line: MarkdownLine, length: Int) -> NSRange? {
        let leadingLength = leadingWhitespaceLength(in: line.text)
        guard leadingLength + length <= line.range.length else { return nil }
        return NSRange(location: line.range.location + leadingLength, length: length)
    }

    private static func numberedMarkerRange(in line: MarkdownLine) -> NSRange? {
        let content = line.text as NSString
        let leadingLength = leadingWhitespaceLength(in: line.text)
        let dot = content.range(of: ".", options: [], range: NSRange(
            location: leadingLength,
            length: content.length - leadingLength
        ))
        guard dot.location != NSNotFound else { return nil }
        let length = min(dot.location - leadingLength + 2, content.length - leadingLength)
        return NSRange(location: line.range.location + leadingLength, length: length)
    }

    private static func leadingWhitespaceLength(in text: String) -> Int {
        let content = text as NSString
        var length = 0
        while length < content.length {
            let character = content.character(at: length)
            guard character == 0x20 || character == 0x09 else { break }
            length += 1
        }
        return length
    }

    private static func isNumberedList(_ text: String) -> Bool {
        text.range(of: #"^\d+\. "#, options: .regularExpression) != nil
    }

    private static func span(
        _ kind: MarkdownHighlightKind,
        _ range: NSRange
    ) -> MarkdownHighlightSpan {
        MarkdownHighlightSpan(kind: kind, range: range)
    }
}
