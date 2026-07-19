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

    func testLockContentionSkipIsExplainedAsANeutralNotice() {
        let presentation = RunNoticePresentation(
            status: "skipped",
            code: "lock_contention",
            technicalMessage: "This run was skipped because Test Agent is already running."
        )

        XCTAssertEqual(presentation.kind, .information)
        XCTAssertEqual(presentation.title, "Run not started")
        XCTAssertEqual(
            presentation.message,
            "This agent was already running, so this extra attempt was skipped."
        )
    }

    func testFailedRunKeepsItsErrorMessageAndWarningTreatment() {
        let presentation = RunNoticePresentation(
            status: "failed",
            code: "runtime_error",
            technicalMessage: "Codex exited with status 1."
        )

        XCTAssertEqual(presentation.kind, .error)
        XCTAssertEqual(presentation.title, "Run failed")
        XCTAssertEqual(presentation.message, "Codex exited with status 1.")
    }
}
