import Foundation
import XCTest

@testable import AgentServerCore

final class RunReviewContractTests: XCTestCase {
    func testDecodesFrozenCompletedRunReviewFixture() throws {
        let review = try JSONDecoder().decode(RunReview.self, from: Self.completedFixtureData())

        XCTAssertEqual(review.outcome, .succeeded)
        XCTAssertEqual(review.headline.text, "Weekly Report finished")
        XCTAssertEqual(review.headline.evidenceReferences, ["run.status"])
        XCTAssertEqual(review.summary.text, "Published the weekly update.")
        XCTAssertEqual(review.accomplishments, [])
        XCTAssertEqual(review.changes.map(\.text), ["Updated weekly-update.md"])
        XCTAssertEqual(review.outputs.map(\.text), ["Weekly update is ready"])
        XCTAssertEqual(review.problems, [])
        XCTAssertEqual(review.suggestions, [])
        XCTAssertEqual(review.timeline.map(\.kind), [.started, .read, .changed, .connected, .finished])
        XCTAssertEqual(review.timeline.map(\.label.text), [
            "Started",
            "Read notes.md",
            "Updated weekly-update.md",
            "Used a configured tool",
            "Finished",
        ])
        XCTAssertEqual(review.timeline.first?.occurredAt, "2026-08-01T09:00:00.000Z")
        XCTAssertNil(review.timeline[1].occurredAt)
        XCTAssertEqual(review.timeline.last?.occurredAt, "2026-08-01T09:02:00.000Z")
        XCTAssertEqual(review.operationalCompleteness, .complete)
        XCTAssertEqual(
            review.technicalDetailsReference,
            "/runs/e566a8f5-becf-49e7-a384-a72d42e9f807"
        )
    }

    private static func completedFixtureData() throws -> Data {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = repositoryRoot
            .appendingPathComponent("docs/v2/fixtures/run-review-completed.json")
        return try Data(contentsOf: fixtureURL)
    }
}
