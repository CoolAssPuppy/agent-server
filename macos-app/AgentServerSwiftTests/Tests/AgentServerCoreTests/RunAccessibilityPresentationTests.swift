import XCTest
@testable import AgentServerCore

final class RunAccessibilityPresentationTests: XCTestCase {
    func testRunRowCombinesStatusTimeAndAvailableMetricsIntoOneLabel() {
        let presentation = RunRowAccessibilityPresentation(
            status: "Completed",
            date: "July 19, 2026",
            time: "3:00 AM",
            turnCount: 4,
            duration: "2m 24s",
            estimatedCost: "$0.12",
            hasConversation: true
        )

        XCTAssertEqual(
            presentation.label,
            "Completed run, July 19, 2026 at 3:00 AM, conversation, 4 turns, duration 2m 24s, estimated cost $0.12"
        )
    }

    func testRunRowOmitsUnavailableAndZeroValueMetrics() {
        let presentation = RunRowAccessibilityPresentation(
            status: "Running",
            date: "July 19, 2026",
            time: "3:00 AM",
            turnCount: 0,
            duration: nil,
            estimatedCost: nil,
            hasConversation: false
        )

        XCTAssertEqual(presentation.label, "Running run, July 19, 2026 at 3:00 AM")
    }

    func testTimelineRowExplainsToolUseWithoutReadingDecorativeContent() {
        let presentation = TimelineRowAccessibilityPresentation(
            message: "Read manuscript.docx",
            kind: .toolUse,
            turn: 2,
            time: "03:01:15"
        )

        XCTAssertEqual(
            presentation.label,
            "Used tool Read manuscript.docx, turn 2, 03:01:15"
        )
    }

    func testTimelineRowAnnouncesErrorsAndOmitsMissingMetadata() {
        let presentation = TimelineRowAccessibilityPresentation(
            message: "Could not connect to Notion",
            kind: .error,
            turn: nil,
            time: nil
        )

        XCTAssertEqual(presentation.label, "Error, Could not connect to Notion")
    }
}
