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
        let output = makeStatement("Report is ready", evidence: ["run.outputs.0"])
        let change = makeStatement("Updated report.md", evidence: ["run.files_modified.0"])
        let problem = makeStatement("Could not publish", evidence: ["run.error"])
        let suggestion = makeStatement("Reconnect Notion", evidence: ["run.code"])
        let review = makeReview(
            changes: [change],
            outputs: [output],
            problems: [problem],
            suggestions: [suggestion]
        )

        let sections = RunReviewPresentation(review: review).sections

        XCTAssertEqual(sections.map(\.kind), [.outputs, .changes, .problems, .suggestions])
        XCTAssertEqual(sections.map(\.title), ["Outputs", "Changes", "Problems", "Suggestions"])
        XCTAssertEqual(sections.map(\.statements), [[output], [change], [problem], [suggestion]])
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

    private func makeReview(
        outcome: RunReviewOutcome = .succeeded,
        changes: [PresentationStatement] = [],
        outputs: [PresentationStatement] = [],
        problems: [PresentationStatement] = [],
        suggestions: [PresentationStatement] = [],
        technicalDetailsReference: String = "/runs/run-1"
    ) -> RunReview {
        RunReview(
            outcome: outcome,
            headline: makeStatement("Run result", evidence: ["run.status"]),
            summary: makeStatement("Run summary", evidence: ["run.summary"]),
            accomplishments: [],
            changes: changes,
            outputs: outputs,
            problems: problems,
            suggestions: suggestions,
            timeline: [],
            operationalCompleteness: .notAssessed,
            technicalDetailsReference: technicalDetailsReference
        )
    }

    private func makeStatement(_ text: String, evidence: [String]) -> PresentationStatement {
        PresentationStatement(text: text, evidenceReferences: evidence)
    }
}
