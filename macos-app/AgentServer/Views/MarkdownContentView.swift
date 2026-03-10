import SwiftUI

struct MarkdownContentView: View {
    let source: String

    private var blocks: [MarkdownBlock] {
        parseMarkdownBlocks(source)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            headingView(level: level, text: text)

        case .paragraph(let text):
            inlineMarkdownText(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineSpacing(2)

        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\u{2022}")
                            .font(.subheadline)
                            .foregroundStyle(.tertiary)
                        inlineMarkdownText(item)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }

        case .numberedList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(index + 1).")
                            .font(.system(.subheadline, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(width: 20, alignment: .trailing)
                        inlineMarkdownText(item)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }

        case .codeBlock(let language, let code):
            VStack(alignment: .leading, spacing: 0) {
                if let language, !language.isEmpty {
                    Text(language)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 10)
                        .padding(.top, 6)
                        .padding(.bottom, 2)
                }
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.primary.opacity(0.8))
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, language != nil ? 4 : 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(.quaternary, lineWidth: 0.5)
            )

        case .table(let headers, let rows):
            tableView(headers: headers, rows: rows)

        case .blockquote(let text):
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(.tertiary)
                    .frame(width: 3)
                inlineMarkdownText(text)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .italic()
                    .padding(.leading, 10)
                    .textSelection(.enabled)
            }

        case .divider:
            Divider()
                .padding(.vertical, 2)
        }
    }

    private func tableView(headers: [String], rows: [[String]]) -> some View {
        let columnCount = headers.count

        return VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(spacing: 0) {
                ForEach(0..<columnCount, id: \.self) { col in
                    inlineMarkdownText(headers[col])
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
            }
            .background(Color(nsColor: .textBackgroundColor).opacity(0.5))

            Divider()

            // Data rows
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                HStack(spacing: 0) {
                    ForEach(0..<columnCount, id: \.self) { col in
                        let cell = col < row.count ? row[col] : ""
                        inlineMarkdownText(cell)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                    }
                }
                .background(rowIndex % 2 == 1 ? Color(nsColor: .textBackgroundColor).opacity(0.25) : .clear)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(.quaternary, lineWidth: 0.5)
        )
    }

    @ViewBuilder
    private func headingView(level: Int, text: String) -> some View {
        switch level {
        case 1:
            inlineMarkdownText(text)
                .font(.system(.title3, weight: .bold))
                .foregroundStyle(.primary)
                .padding(.top, 4)
        case 2:
            inlineMarkdownText(text)
                .font(.system(.headline))
                .foregroundStyle(.primary)
                .padding(.top, 2)
        default:
            inlineMarkdownText(text)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(.primary)
        }
    }

    private func inlineMarkdownText(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }
}

// MARK: - Block parser

private enum MarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(text: String)
    case bulletList(items: [String])
    case numberedList(items: [String])
    case codeBlock(language: String?, code: String)
    case table(headers: [String], rows: [[String]])
    case blockquote(text: String)
    case divider
}

private func parseMarkdownBlocks(_ source: String) -> [MarkdownBlock] {
    let lines = source.components(separatedBy: "\n")
    var blocks: [MarkdownBlock] = []
    var index = 0

    while index < lines.count {
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            index += 1
            continue
        }

        // Code block
        if trimmed.hasPrefix("```") {
            let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            var codeLines: [String] = []
            index += 1
            while index < lines.count {
                if lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    index += 1
                    break
                }
                codeLines.append(lines[index])
                index += 1
            }
            blocks.append(.codeBlock(
                language: language.isEmpty ? nil : language,
                code: codeLines.joined(separator: "\n")
            ))
            continue
        }

        // Heading
        if let match = trimmed.range(of: #"^(#{1,6})\s+(.+)$"#, options: .regularExpression) {
            let matched = String(trimmed[match])
            let hashes = matched.prefix(while: { $0 == "#" })
            let text = String(matched.dropFirst(hashes.count)).trimmingCharacters(in: .whitespaces)
            blocks.append(.heading(level: hashes.count, text: text))
            index += 1
            continue
        }

        // Table (must check before divider since separator rows contain ---)
        if trimmed.hasPrefix("|") && trimmed.hasSuffix("|") {
            let headerCells = parseTableRow(trimmed)
            // Check next line is a separator row like |---|---|
            if index + 1 < lines.count {
                let nextTrimmed = lines[index + 1].trimmingCharacters(in: .whitespaces)
                if nextTrimmed.hasPrefix("|") && nextTrimmed.contains("-") && isSeparatorRow(nextTrimmed) {
                    index += 2 // skip header and separator
                    var dataRows: [[String]] = []
                    while index < lines.count {
                        let rowLine = lines[index].trimmingCharacters(in: .whitespaces)
                        if rowLine.hasPrefix("|") && rowLine.hasSuffix("|") {
                            dataRows.append(parseTableRow(rowLine))
                            index += 1
                        } else {
                            break
                        }
                    }
                    blocks.append(.table(headers: headerCells, rows: dataRows))
                    continue
                }
            }
        }

        // Divider
        if trimmed.allSatisfy({ $0 == "-" || $0 == "*" || $0 == "_" || $0 == " " })
            && trimmed.filter({ $0 != " " }).count >= 3
            && Set(trimmed.filter({ $0 != " " })).count == 1 {
            blocks.append(.divider)
            index += 1
            continue
        }

        // Blockquote
        if trimmed.hasPrefix("> ") {
            var quoteLines: [String] = []
            while index < lines.count {
                let l = lines[index].trimmingCharacters(in: .whitespaces)
                if l.hasPrefix("> ") {
                    quoteLines.append(String(l.dropFirst(2)))
                } else if l.hasPrefix(">") {
                    quoteLines.append(String(l.dropFirst(1)))
                } else {
                    break
                }
                index += 1
            }
            blocks.append(.blockquote(text: quoteLines.joined(separator: " ")))
            continue
        }

        // Bullet list
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
            var items: [String] = []
            while index < lines.count {
                let l = lines[index].trimmingCharacters(in: .whitespaces)
                if l.hasPrefix("- ") {
                    items.append(String(l.dropFirst(2)))
                } else if l.hasPrefix("* ") {
                    items.append(String(l.dropFirst(2)))
                } else if l.isEmpty {
                    break
                } else if !items.isEmpty {
                    // Continuation line
                    items[items.count - 1] += " " + l
                } else {
                    break
                }
                index += 1
            }
            blocks.append(.bulletList(items: items))
            continue
        }

        // Numbered list
        if trimmed.range(of: #"^\d+\.\s+"#, options: .regularExpression) != nil {
            var items: [String] = []
            while index < lines.count {
                let l = lines[index].trimmingCharacters(in: .whitespaces)
                if let dotRange = l.range(of: #"^\d+\.\s+"#, options: .regularExpression) {
                    items.append(String(l[dotRange.upperBound...]))
                } else if l.isEmpty {
                    break
                } else if !items.isEmpty {
                    items[items.count - 1] += " " + l
                } else {
                    break
                }
                index += 1
            }
            blocks.append(.numberedList(items: items))
            continue
        }

        // Paragraph (collect consecutive non-empty lines)
        var paragraphLines: [String] = []
        while index < lines.count {
            let l = lines[index]
            let t = l.trimmingCharacters(in: .whitespaces)
            if t.isEmpty || t.hasPrefix("#") || t.hasPrefix("```") || t.hasPrefix("- ") || t.hasPrefix("* ") || t.hasPrefix("> ") || (t.hasPrefix("|") && t.hasSuffix("|")) || t.range(of: #"^\d+\.\s+"#, options: .regularExpression) != nil {
                break
            }
            paragraphLines.append(l)
            index += 1
        }
        if !paragraphLines.isEmpty {
            blocks.append(.paragraph(text: paragraphLines.joined(separator: " ")))
        }
    }

    return blocks
}

private func parseTableRow(_ line: String) -> [String] {
    let stripped = line.trimmingCharacters(in: .whitespaces)
    let inner: String
    if stripped.hasPrefix("|") && stripped.hasSuffix("|") {
        inner = String(stripped.dropFirst().dropLast())
    } else {
        inner = stripped
    }
    return inner.split(separator: "|", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespaces) }
}

private func isSeparatorRow(_ line: String) -> Bool {
    let cells = parseTableRow(line)
    return cells.allSatisfy { cell in
        let stripped = cell.trimmingCharacters(in: .whitespaces)
        return stripped.allSatisfy { $0 == "-" || $0 == ":" || $0 == " " } && stripped.contains("-")
    }
}
