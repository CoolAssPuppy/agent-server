import AppKit
import SwiftUI

struct MarkdownEditor: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool = true

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder

        let textView = NSTextView()
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.isRichText = false
        textView.usesFindBar = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textColor = .textColor
        textView.backgroundColor = .textBackgroundColor
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainerInset = NSSize(width: 12, height: 12)

        textView.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = true
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.minSize = NSSize(width: 0, height: 0)

        textView.delegate = context.coordinator
        context.coordinator.textView = textView

        scrollView.documentView = textView

        let attributed = MarkdownHighlighter.highlight(text)
        textView.textStorage?.setAttributedString(attributed)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }

        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            let attributed = MarkdownHighlighter.highlight(text)
            textView.textStorage?.setAttributedString(attributed)
            textView.selectedRanges = selectedRanges
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownEditor
        weak var textView: NSTextView?
        private var isUpdating = false

        init(_ parent: MarkdownEditor) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard !isUpdating, let textView else { return }

            isUpdating = true
            defer { isUpdating = false }

            let newText = textView.string
            parent.text = newText

            let selectedRanges = textView.selectedRanges
            let attributed = MarkdownHighlighter.highlight(newText)
            textView.textStorage?.setAttributedString(attributed)
            textView.selectedRanges = selectedRanges
        }
    }
}

enum MarkdownHighlighter {
    private static let baseFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    private static let boldFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .bold)
    private static let h1Font = NSFont.monospacedSystemFont(ofSize: 17, weight: .bold)
    private static let h2Font = NSFont.monospacedSystemFont(ofSize: 15, weight: .bold)
    private static let h3Font = NSFont.monospacedSystemFont(ofSize: 14, weight: .semibold)

    static func highlight(_ text: String) -> NSAttributedString {
        let result = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: baseFont,
                .foregroundColor: NSColor.textColor,
            ]
        )

        let lines = text.components(separatedBy: "\n")
        var offset = 0
        var inFrontmatter = false
        var frontmatterStarted = false
        var inCodeBlock = false

        for line in lines {
            let lineRange = NSRange(location: offset, length: line.count)
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed == "---" {
                if !frontmatterStarted {
                    inFrontmatter = true
                    frontmatterStarted = true
                    applyFrontmatterDelimiter(result, range: lineRange)
                } else if inFrontmatter {
                    inFrontmatter = false
                    applyFrontmatterDelimiter(result, range: lineRange)
                }
                offset += line.count + 1
                continue
            }

            if inFrontmatter {
                applyFrontmatter(result, line: line, range: lineRange)
                offset += line.count + 1
                continue
            }

            if trimmed.hasPrefix("```") {
                inCodeBlock.toggle()
                applyCodeFence(result, range: lineRange)
                offset += line.count + 1
                continue
            }

            if inCodeBlock {
                applyCodeBlock(result, range: lineRange)
                offset += line.count + 1
                continue
            }

            if trimmed.hasPrefix("### ") {
                applyHeading(result, range: lineRange, font: h3Font)
            } else if trimmed.hasPrefix("## ") {
                applyHeading(result, range: lineRange, font: h2Font)
            } else if trimmed.hasPrefix("# ") {
                applyHeading(result, range: lineRange, font: h1Font)
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                applyBullet(result, line: line, range: lineRange)
            } else if let _ = trimmed.range(of: #"^\d+\. "#, options: .regularExpression) {
                applyNumberedList(result, line: line, range: lineRange)
            } else if trimmed.hasPrefix("#") && !trimmed.hasPrefix("# ") {
                applyComment(result, range: lineRange)
            }

            applyInlineStyles(result, line: line, offset: offset)

            offset += line.count + 1
        }

        return result
    }

    private static func applyFrontmatterDelimiter(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: NSColor.systemOrange, range: range)
        str.addAttribute(.font, value: boldFont, range: range)
    }

    private static func applyFrontmatter(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        str.addAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, range: range)

        if let colonIdx = line.firstIndex(of: ":") {
            let keyLength = line.distance(from: line.startIndex, to: colonIdx)
            let keyRange = NSRange(location: range.location, length: keyLength)
            str.addAttribute(.foregroundColor, value: NSColor.systemOrange, range: keyRange)
            str.addAttribute(.font, value: boldFont, range: keyRange)
        }
    }

    private static func applyCodeFence(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: NSColor.systemGreen, range: range)
    }

    private static func applyCodeBlock(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: NSColor.systemGreen, range: range)
        str.addAttribute(.backgroundColor, value: NSColor.textColor.withAlphaComponent(0.04), range: range)
    }

    private static func applyHeading(_ str: NSMutableAttributedString, range: NSRange, font: NSFont) {
        str.addAttribute(.font, value: font, range: range)
        str.addAttribute(.foregroundColor, value: NSColor.systemBlue, range: range)
    }

    private static func applyBullet(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        let markerRange = NSRange(location: range.location + leading, length: 2)
        if markerRange.location + markerRange.length <= range.location + range.length {
            str.addAttribute(.foregroundColor, value: NSColor.systemTeal, range: markerRange)
        }
    }

    private static func applyNumberedList(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        if let dotIdx = line.firstIndex(of: ".") {
            let numLength = line.distance(from: line.startIndex, to: dotIdx) + 2 - leading
            let markerRange = NSRange(location: range.location + leading, length: min(numLength, range.length - leading))
            str.addAttribute(.foregroundColor, value: NSColor.systemTeal, range: markerRange)
        }
    }

    private static func applyComment(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor, range: range)
    }

    private static func applyInlineStyles(_ str: NSMutableAttributedString, line: String, offset: Int) {
        applyInlinePattern(str, line: line, offset: offset,
                           pattern: #"`[^`]+`"#,
                           color: .systemGreen, font: nil)

        applyInlinePattern(str, line: line, offset: offset,
                           pattern: #"\*\*[^*]+\*\*"#,
                           color: nil, font: boldFont)
    }

    private static func applyInlinePattern(
        _ str: NSMutableAttributedString,
        line: String,
        offset: Int,
        pattern: String,
        color: NSColor?,
        font: NSFont?
    ) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let nsLine = line as NSString
        let matches = regex.matches(in: line, range: NSRange(location: 0, length: nsLine.length))

        for match in matches {
            let range = NSRange(location: offset + match.range.location, length: match.range.length)
            if let color { str.addAttribute(.foregroundColor, value: color, range: range) }
            if let font { str.addAttribute(.font, value: font, range: range) }
        }
    }
}
