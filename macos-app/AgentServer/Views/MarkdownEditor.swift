import AppKit
import SwiftUI

struct MarkdownEditor: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool = true

    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    /// Pushes the current SwiftUI colorScheme into the shared EditorTheme
    /// so syntax colors follow the app's Agent Server palette instead of the
    /// system appearance. Called on make + update.
    private func syncThemeAppearance() {
        EditorTheme.shared.isDarkOverride = (colorScheme == .dark)
    }

    func makeNSView(context: Context) -> NSScrollView {
        syncThemeAppearance()
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder
        scrollView.scrollerStyle = .overlay
        // Keep the NSScrollView transparent so the SwiftUI card background
        // (theme.tokens.card) is the only surface rendered. Without this the
        // scroll view drew its own solid fill, which on dark palettes reads
        // as a faint drop-shadow edge inside the card.
        scrollView.drawsBackground = false
        scrollView.contentView.drawsBackground = false

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

        syncThemeAppearance()
        applyTheme(to: textView)

        // Always re-highlight on update so a theme switch re-colors the
        // existing document. Only rewrite the storage when text content
        // actually changed; otherwise re-apply attributes to the current
        // storage in place.
        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            let scrollOrigin = scrollView.contentView.bounds.origin

            let attributed = EditorHighlighter.highlight(text)
            textView.textStorage?.setAttributedString(attributed)

            textView.selectedRanges = selectedRanges
            scrollView.contentView.setBoundsOrigin(scrollOrigin)
        } else if let storage = textView.textStorage {
            storage.beginEditing()
            EditorHighlighter.applyHighlighting(to: storage, text: text)
            storage.endEditing()
            // Cursor position is preserved implicitly since we only touched
            // attributes, not characters.
        }
    }

    private func applyTheme(to textView: NSTextView) {
        let theme = EditorTheme.shared
        // Transparent so the SwiftUI card (theme.tokens.card) is the only
        // surface rendered. The hardcoded theme.backgroundColor (#1e1e1e)
        // was slightly different from theme.tokens.card (#1C1C1C), creating
        // a faint edge inside the rounded card that read as a drop shadow.
        textView.backgroundColor = .clear
        textView.drawsBackground = false
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
            let scrollOrigin = textView.enclosingScrollView?.contentView.bounds.origin

            guard let textStorage = textView.textStorage else { return }
            let fullRange = NSRange(location: 0, length: textStorage.length)

            textStorage.beginEditing()
            textStorage.setAttributes(
                [.font: EditorTheme.shared.baseFont, .foregroundColor: EditorTheme.shared.foregroundColor],
                range: fullRange
            )
            EditorHighlighter.applyHighlighting(to: textStorage, text: newText)
            textStorage.endEditing()

            textView.selectedRanges = selectedRanges
            if let scrollOrigin, let scrollView = textView.enclosingScrollView {
                scrollView.contentView.setBoundsOrigin(scrollOrigin)
            }
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

    /// Explicitly set from SwiftUI via the Agent Server palette. Falls back to
    /// NSApp.effectiveAppearance if no override exists so existing callers
    /// still get a sensible default. The override is critical when the app
    /// runs a Agent Server palette whose dark/light mode doesn't match the
    /// system appearance (e.g. Nerds dark running under macOS Light Mode).
    var isDarkOverride: Bool? = nil

    var isDark: Bool {
        if let isDarkOverride { return isDarkOverride }
        return NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
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

    static func applyHighlighting(to str: NSMutableAttributedString, text: String) {
        for span in MarkdownHighlightRanges.spans(in: text) {
            apply(span, to: str)
        }
    }

    private static func apply(
        _ span: MarkdownHighlightSpan,
        to str: NSMutableAttributedString
    ) {
        switch span.kind {
        case .frontmatterDelimiter:
            str.addAttribute(.foregroundColor, value: theme.frontmatterDelimiter, range: span.range)
            str.addAttribute(.font, value: theme.boldFont, range: span.range)
        case .frontmatterValue:
            str.addAttribute(.foregroundColor, value: theme.frontmatterValue, range: span.range)
        case .yamlKey:
            str.addAttribute(.foregroundColor, value: theme.yamlKey, range: span.range)
        case .yamlBoolean:
            str.addAttribute(.foregroundColor, value: theme.yamlBoolean, range: span.range)
        case .yamlNumber:
            str.addAttribute(.foregroundColor, value: theme.number, range: span.range)
        case .yamlString:
            str.addAttribute(.foregroundColor, value: theme.yamlString, range: span.range)
        case .bullet, .numberedList:
            str.addAttribute(.foregroundColor, value: theme.bullet, range: span.range)
        case .heading(let level):
            let font = switch level {
            case 1: theme.h1Font
            case 2: theme.h2Font
            default: theme.h3Font
            }
            str.addAttribute(.font, value: font, range: span.range)
            str.addAttribute(.foregroundColor, value: theme.heading, range: span.range)
        case .comment, .codeFence:
            str.addAttribute(.foregroundColor, value: theme.comment, range: span.range)
        case .codeBlock:
            str.addAttribute(.foregroundColor, value: theme.codeBlock, range: span.range)
            str.addAttribute(.backgroundColor, value: theme.codeBlockBackground, range: span.range)
        case .inlineCode:
            str.addAttribute(.foregroundColor, value: theme.inlineCode, range: span.range)
            str.addAttribute(.backgroundColor, value: theme.inlineCodeBackground, range: span.range)
        case .bold:
            str.addAttribute(.foregroundColor, value: theme.bold, range: span.range)
            str.addAttribute(.font, value: theme.boldFont, range: span.range)
        }
    }

    static func highlight(_ text: String) -> NSAttributedString {
        let result = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: theme.baseFont,
                .foregroundColor: theme.foregroundColor,
            ]
        )

        applyHighlighting(to: result, text: text)

        return result
    }
}
