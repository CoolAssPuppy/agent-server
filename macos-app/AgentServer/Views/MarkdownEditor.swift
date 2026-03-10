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
        scrollView.scrollerStyle = .overlay

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
        textView.font = EditorTheme.shared.baseFont
        textView.insertionPointColor = EditorTheme.shared.cursorColor
        textView.selectedTextAttributes = [
            .backgroundColor: EditorTheme.shared.selectionColor,
        ]
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainerInset = NSSize(width: 16, height: 16)

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

        applyTheme(to: textView)
        let attributed = EditorHighlighter.highlight(text)
        textView.textStorage?.setAttributedString(attributed)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }

        applyTheme(to: textView)

        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            let attributed = EditorHighlighter.highlight(text)
            textView.textStorage?.setAttributedString(attributed)
            textView.selectedRanges = selectedRanges
        }
    }

    private func applyTheme(to textView: NSTextView) {
        let theme = EditorTheme.shared
        textView.backgroundColor = theme.backgroundColor
        textView.textColor = theme.foregroundColor
        textView.insertionPointColor = theme.cursorColor
        textView.selectedTextAttributes = [
            .backgroundColor: theme.selectionColor,
        ]
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
            let attributed = EditorHighlighter.highlight(newText)
            textView.textStorage?.setAttributedString(attributed)
            textView.selectedRanges = selectedRanges
        }
    }
}

// MARK: - Editor theme (VS Code Dark+/Light+ inspired)

final class EditorTheme {
    static let shared = EditorTheme()

    let baseFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    let boldFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .bold)
    let h1Font = NSFont.monospacedSystemFont(ofSize: 17, weight: .bold)
    let h2Font = NSFont.monospacedSystemFont(ofSize: 15, weight: .bold)
    let h3Font = NSFont.monospacedSystemFont(ofSize: 14, weight: .semibold)

    private var isDark: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }

    // Background and editor chrome
    var backgroundColor: NSColor {
        isDark ? NSColor(hex: 0x1e1e1e) : NSColor(hex: 0xffffff)
    }

    var foregroundColor: NSColor {
        isDark ? NSColor(hex: 0xd4d4d4) : NSColor(hex: 0x1f1f1f)
    }

    var cursorColor: NSColor {
        isDark ? NSColor(hex: 0xaeafad) : NSColor(hex: 0x000000)
    }

    var selectionColor: NSColor {
        isDark ? NSColor(hex: 0x264f78) : NSColor(hex: 0xadd6ff)
    }

    // Syntax colors
    var keyword: NSColor {
        isDark ? NSColor(hex: 0x569cd6) : NSColor(hex: 0x0000ff)
    }

    var string: NSColor {
        isDark ? NSColor(hex: 0xce9178) : NSColor(hex: 0xa31515)
    }

    var number: NSColor {
        isDark ? NSColor(hex: 0xb5cea8) : NSColor(hex: 0x098658)
    }

    var comment: NSColor {
        isDark ? NSColor(hex: 0x6a9955) : NSColor(hex: 0x008000)
    }

    var type: NSColor {
        isDark ? NSColor(hex: 0x4ec9b0) : NSColor(hex: 0x267f99)
    }

    var yamlKey: NSColor {
        isDark ? NSColor(hex: 0x9cdcfe) : NSColor(hex: 0x001080)
    }

    var heading: NSColor {
        isDark ? NSColor(hex: 0x569cd6) : NSColor(hex: 0x0000ff)
    }

    var codeBlock: NSColor {
        isDark ? NSColor(hex: 0xce9178) : NSColor(hex: 0xa31515)
    }

    var codeBlockBackground: NSColor {
        isDark ? NSColor(hex: 0x1a1a1a) : NSColor(hex: 0xf5f5f5)
    }

    var frontmatterDelimiter: NSColor {
        isDark ? NSColor(hex: 0x808080) : NSColor(hex: 0x808080)
    }

    var frontmatterValue: NSColor {
        isDark ? NSColor(hex: 0xd4d4d4).withAlphaComponent(0.7) : NSColor(hex: 0x1f1f1f).withAlphaComponent(0.7)
    }

    var bullet: NSColor {
        isDark ? NSColor(hex: 0xdcdcaa) : NSColor(hex: 0x795e26)
    }

    var bold: NSColor {
        isDark ? NSColor(hex: 0xd4d4d4) : NSColor(hex: 0x1f1f1f)
    }

    var inlineCode: NSColor {
        isDark ? NSColor(hex: 0xce9178) : NSColor(hex: 0xa31515)
    }

    var inlineCodeBackground: NSColor {
        isDark ? NSColor(hex: 0x2d2d2d) : NSColor(hex: 0xf0f0f0)
    }

    var lineNumber: NSColor {
        isDark ? NSColor(hex: 0x858585) : NSColor(hex: 0x237893)
    }

    var yamlBoolean: NSColor {
        isDark ? NSColor(hex: 0x569cd6) : NSColor(hex: 0x0000ff)
    }

    var yamlString: NSColor {
        isDark ? NSColor(hex: 0xce9178) : NSColor(hex: 0xa31515)
    }
}

// MARK: - NSColor hex extension

private extension NSColor {
    convenience init(hex: UInt32) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255.0
        let g = CGFloat((hex >> 8) & 0xFF) / 255.0
        let b = CGFloat(hex & 0xFF) / 255.0
        self.init(srgbRed: r, green: g, blue: b, alpha: 1.0)
    }
}

// MARK: - Syntax highlighter

enum EditorHighlighter {
    private static var theme: EditorTheme { EditorTheme.shared }

    static func highlight(_ text: String) -> NSAttributedString {
        let result = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: theme.baseFont,
                .foregroundColor: theme.foregroundColor,
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
                applyHeading(result, range: lineRange, font: theme.h3Font)
            } else if trimmed.hasPrefix("## ") {
                applyHeading(result, range: lineRange, font: theme.h2Font)
            } else if trimmed.hasPrefix("# ") {
                applyHeading(result, range: lineRange, font: theme.h1Font)
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
        str.addAttribute(.foregroundColor, value: theme.frontmatterDelimiter, range: range)
        str.addAttribute(.font, value: theme.boldFont, range: range)
    }

    private static func applyFrontmatter(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        str.addAttribute(.foregroundColor, value: theme.frontmatterValue, range: range)

        if let colonIdx = line.firstIndex(of: ":") {
            let keyLength = line.distance(from: line.startIndex, to: colonIdx)
            let keyRange = NSRange(location: range.location, length: keyLength)
            str.addAttribute(.foregroundColor, value: theme.yamlKey, range: keyRange)

            // Color the value part
            let valueStart = line.distance(from: line.startIndex, to: colonIdx) + 1
            if valueStart < line.count {
                let valueRange = NSRange(location: range.location + valueStart, length: line.count - valueStart)
                let valueTrimmed = String(line[line.index(after: colonIdx)...]).trimmingCharacters(in: .whitespaces)

                if valueTrimmed == "true" || valueTrimmed == "false" {
                    str.addAttribute(.foregroundColor, value: theme.yamlBoolean, range: valueRange)
                } else if let _ = Int(valueTrimmed) {
                    str.addAttribute(.foregroundColor, value: theme.number, range: valueRange)
                } else if valueTrimmed.hasPrefix("\"") || valueTrimmed.hasPrefix("'") {
                    str.addAttribute(.foregroundColor, value: theme.yamlString, range: valueRange)
                }
            }
        } else {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- ") {
                let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
                let markerRange = NSRange(location: range.location + leading, length: 2)
                if markerRange.location + markerRange.length <= range.location + range.length {
                    str.addAttribute(.foregroundColor, value: theme.bullet, range: markerRange)
                }
                // Value after "- "
                if leading + 2 < line.count {
                    let itemRange = NSRange(location: range.location + leading + 2, length: line.count - leading - 2)
                    str.addAttribute(.foregroundColor, value: theme.yamlString, range: itemRange)
                }
            }
        }
    }

    private static func applyCodeFence(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: theme.comment, range: range)
    }

    private static func applyCodeBlock(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: theme.codeBlock, range: range)
        str.addAttribute(.backgroundColor, value: theme.codeBlockBackground, range: range)
    }

    private static func applyHeading(_ str: NSMutableAttributedString, range: NSRange, font: NSFont) {
        str.addAttribute(.font, value: font, range: range)
        str.addAttribute(.foregroundColor, value: theme.heading, range: range)
    }

    private static func applyBullet(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        let markerRange = NSRange(location: range.location + leading, length: 2)
        if markerRange.location + markerRange.length <= range.location + range.length {
            str.addAttribute(.foregroundColor, value: theme.bullet, range: markerRange)
        }
    }

    private static func applyNumberedList(_ str: NSMutableAttributedString, line: String, range: NSRange) {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        if let dotIdx = line.firstIndex(of: ".") {
            let numLength = line.distance(from: line.startIndex, to: dotIdx) + 2 - leading
            let markerRange = NSRange(location: range.location + leading, length: min(numLength, range.length - leading))
            str.addAttribute(.foregroundColor, value: theme.bullet, range: markerRange)
        }
    }

    private static func applyComment(_ str: NSMutableAttributedString, range: NSRange) {
        str.addAttribute(.foregroundColor, value: theme.comment, range: range)
    }

    private static func applyInlineStyles(_ str: NSMutableAttributedString, line: String, offset: Int) {
        // Inline code: `text`
        applyInlinePattern(str, line: line, offset: offset,
                           pattern: #"`[^`]+`"#,
                           color: theme.inlineCode, font: nil,
                           backgroundColor: theme.inlineCodeBackground)

        // Bold: **text**
        applyInlinePattern(str, line: line, offset: offset,
                           pattern: #"\*\*[^*]+\*\*"#,
                           color: theme.bold, font: theme.boldFont,
                           backgroundColor: nil)
    }

    private static func applyInlinePattern(
        _ str: NSMutableAttributedString,
        line: String,
        offset: Int,
        pattern: String,
        color: NSColor?,
        font: NSFont?,
        backgroundColor: NSColor?
    ) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let nsLine = line as NSString
        let matches = regex.matches(in: line, range: NSRange(location: 0, length: nsLine.length))

        for match in matches {
            let range = NSRange(location: offset + match.range.location, length: match.range.length)
            if let color { str.addAttribute(.foregroundColor, value: color, range: range) }
            if let font { str.addAttribute(.font, value: font, range: range) }
            if let backgroundColor { str.addAttribute(.backgroundColor, value: backgroundColor, range: range) }
        }
    }
}
