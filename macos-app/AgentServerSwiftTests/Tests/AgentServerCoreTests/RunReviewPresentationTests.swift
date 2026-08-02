import XCTest

@testable import AgentServerCore

final class RunReviewPresentationTests: XCTestCase {
    func testPresentsEveryOutcomeInPlainLanguage() {
        let expectedPresentations: [(RunReviewOutcome, String, RunReviewPresentationTone, String)] = [
            (.succeeded, "Finished", .positive, "checkmark.circle.fill"),
            (.partial, "Finished with problems", .caution, "exclamationmark.triangle.fill"),
            (.failed, "Needs attention", .negative, "xmark.circle.fill"),
            (.canceled, "Canceled", .neutral, "xmark.circle"),
            (.skipped, "Did not run", .neutral, "forward.end.circle"),
            (.working, "Working", .caution, "bolt.circle.fill"),
            (.waiting, "Waiting for a response", .caution, "hourglass"),
            (.unknown, "Status unavailable", .neutral, "questionmark.circle"),
        ]

        for (outcome, label, tone, symbolName) in expectedPresentations {
            let presentation = RunReviewPresentation(review: makeReview(outcome: outcome))

            XCTAssertEqual(presentation.outcomeLabel, label)
            XCTAssertEqual(presentation.tone, tone)
            XCTAssertEqual(presentation.symbolName, symbolName)
        }
    }

    func testOrdersOnlyConsumerSectionsThatContainEvidenceBackedStatements() {
        let accomplishment = makeStatement("Published the report", evidence: ["run.summary"])
        let output = makeStatement("Report is ready", evidence: ["run.outputs.0"])
        let change = makeStatement("Updated report.md", evidence: ["run.files_modified.0"])
        let problem = makeStatement("Could not publish", evidence: ["run.error"])
        let suggestion = makeStatement("Reconnect Notion", evidence: ["run.code"])
        let review = makeReview(
            accomplishments: [accomplishment],
            changes: [change],
            outputs: [output],
            problems: [problem],
            suggestions: [suggestion]
        )

        let sections = RunReviewPresentation(review: review).sections

        XCTAssertEqual(
            sections.map(\.kind),
            [.accomplishments, .outputs, .changes, .problems, .suggestions]
        )
        XCTAssertEqual(
            sections.map(\.title),
            ["Accomplishments", "Outputs", "Changes", "Problems", "Suggestions"]
        )
        XCTAssertEqual(
            sections.map(\.statements),
            [[accomplishment], [output], [change], [problem], [suggestion]]
        )
    }

    func testOmitsEmptyConsumerSections() {
        let problem = makeStatement("Connection needs attention", evidence: ["run.error"])
        let review = makeReview(problems: [problem])

        let sections = RunReviewPresentation(review: review).sections

        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections.first?.kind, .problems)
        XCTAssertEqual(sections.first?.statements, [problem])
    }

    func testMakesTechnicalDetailsAvailableOnlyForAUsableReference() {
        XCTAssertTrue(
            RunReviewPresentation(review: makeReview(technicalDetailsReference: "/runs/run-1"))
                .isTechnicalDetailsAvailable
        )
        XCTAssertFalse(
            RunReviewPresentation(review: makeReview(technicalDetailsReference: "  \n"))
                .isTechnicalDetailsAvailable
        )
    }

    func testExplainsOperationalCompletenessWithoutTurningItIntoConfidence() {
        let expected: [(OperationalCompleteness, String, String)] = [
            (.complete, "Complete", "All required outputs were produced."),
            (.incomplete, "Incomplete", "A required output or step is missing."),
            (.notAssessed, "Not assessed", "No deterministic output requirement was available to check."),
        ]

        for (completeness, label, explanation) in expected {
            let presentation = RunReviewPresentation(
                review: makeReview(operationalCompleteness: completeness)
            )

            XCTAssertEqual(presentation.operationalCompletenessLabel, label)
            XCTAssertEqual(presentation.operationalCompletenessExplanation, explanation)
        }
    }

    func testPreservesWaitingRequestReasonActionAndExpiryForTheView() {
        let waitingFor = makeStatement(
            "Choose which report to publish.",
            evidence: ["interaction.request.message"]
        )
        let reason = makeStatement(
            "The assistant needs your response before it can continue.",
            evidence: ["interaction.status", "interaction.runId"]
        )
        let action = PresentationAction(
            kind: .respond,
            label: "Choose",
            targetReference: "interaction:interaction-1"
        )
        let expiry = Date(timeIntervalSince1970: 1_775_127_400)
        let review = makeReview(
            outcome: .waiting,
            waiting: RunReviewWaiting(
                waitingFor: waitingFor,
                reason: reason,
                userAction: action,
                expiresAt: expiry
            )
        )

        let waiting = RunReviewPresentation(review: review).waiting

        XCTAssertEqual(waiting?.waitingFor, waitingFor)
        XCTAssertEqual(waiting?.reason, reason)
        XCTAssertEqual(waiting?.userAction, action)
        XCTAssertEqual(waiting?.expiresAt, expiry)
    }

    private func makeReview(
        outcome: RunReviewOutcome = .succeeded,
        accomplishments: [PresentationStatement] = [],
        changes: [PresentationStatement] = [],
        outputs: [PresentationStatement] = [],
        problems: [PresentationStatement] = [],
        suggestions: [PresentationStatement] = [],
        operationalCompleteness: OperationalCompleteness = .notAssessed,
        waiting: RunReviewWaiting? = nil,
        technicalDetailsReference: String = "/runs/run-1"
    ) -> RunReview {
        RunReview(
            outcome: outcome,
            headline: makeStatement("Run result", evidence: ["run.status"]),
            summary: makeStatement("Run summary", evidence: ["run.summary"]),
            accomplishments: accomplishments,
            changes: changes,
            outputs: outputs,
            problems: problems,
            suggestions: suggestions,
            timeline: [],
            operationalCompleteness: operationalCompleteness,
            waiting: waiting,
            technicalDetailsReference: technicalDetailsReference
        )
    }

    private func makeStatement(_ text: String, evidence: [String]) -> PresentationStatement {
        PresentationStatement(text: text, evidenceReferences: evidence)
    }
}
