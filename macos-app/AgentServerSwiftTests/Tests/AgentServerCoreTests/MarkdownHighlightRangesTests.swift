import XCTest
@testable import AgentServerCore

final class MarkdownHighlightRangesTests: XCTestCase {
    func testComposedUnicodeKeepsInlineAndFollowingLineRangesAligned() throws {
        let text = "Cafe\u{301} **bold**\n# Next"
        let spans = MarkdownHighlightRanges.spans(in: text)

        XCTAssertEqual(
            try substring(for: .bold, in: text, spans: spans),
            "**bold**"
        )
        XCTAssertEqual(
            try substring(for: .heading(level: 1), in: text, spans: spans),
            "# Next"
        )
    }

    func testEmojiDoesNotShiftBulletNumberOrInlineCodeRanges() throws {
        let text = "Intro 👩🏽‍💻\n  - `ship`\n  12. **done**"
        let spans = MarkdownHighlightRanges.spans(in: text)

        XCTAssertEqual(try substring(for: .bullet, in: text, spans: spans), "- ")
        XCTAssertEqual(try substring(for: .inlineCode, in: text, spans: spans), "`ship`")
        XCTAssertEqual(try substring(for: .numberedList, in: text, spans: spans), "12. ")
        XCTAssertEqual(try substring(for: .bold, in: text, spans: spans), "**done**")
    }

    func testCRLFFrontmatterExcludesLineEndingsAndStylesUTF16Values() throws {
        let text = "---\r\ntítle🚀: \"Launch 🚀\"\r\nenabled: true\r\n---\r\nBody"
        let spans = MarkdownHighlightRanges.spans(in: text)
        let lines = MarkdownHighlightRanges.lines(in: text)

        XCTAssertEqual(lines.map(\.text), ["---", "títle🚀: \"Launch 🚀\"", "enabled: true", "---", "Body"])
        XCTAssertEqual(spans.filter { $0.kind == .frontmatterDelimiter }.count, 2)
        XCTAssertEqual(try substring(for: .yamlKey, in: text, spans: spans), "títle🚀")
        XCTAssertEqual(
            try substring(for: .yamlString, in: text, spans: spans),
            " \"Launch 🚀\""
        )
        XCTAssertEqual(
            try substring(for: .yamlBoolean, in: text, spans: spans),
            " true"
        )
    }

    func testMixedMarkdownProducesOnlyValidUTF16Ranges() {
        let text = "---\nitems:\n  - café 🧪\n---\n## Héllo 👋\n- **bold** and `code`\n7. item\n```swift\nlet icon = \"🚀\"\n```"
        let utf16Length = (text as NSString).length
        let spans = MarkdownHighlightRanges.spans(in: text)

        XCTAssertFalse(spans.isEmpty)
        XCTAssertEqual(
            try? substring(for: .yamlString, in: text, spans: spans),
            "café 🧪"
        )
        for span in spans {
            XCTAssertGreaterThanOrEqual(span.range.location, 0)
            XCTAssertGreaterThanOrEqual(span.range.length, 0)
            XCTAssertLessThanOrEqual(NSMaxRange(span.range), utf16Length)
        }
    }

    private func substring(
        for kind: MarkdownHighlightKind,
        in text: String,
        spans: [MarkdownHighlightSpan]
    ) throws -> String {
        let span = try XCTUnwrap(spans.first { $0.kind == kind })
        return (text as NSString).substring(with: span.range)
    }
}
