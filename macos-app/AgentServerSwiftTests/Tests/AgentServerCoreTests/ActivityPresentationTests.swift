import Foundation
import XCTest

@testable import AgentServerCore

final class ActivityPresentationTests: XCTestCase {
    func testFiltersUseConsumerLabelsAndMatchTheExpectedStates() {
        let items = [
            makeItem(id: "needs-you", state: .needsYou, startedAt: date(1)),
            makeItem(id: "working", state: .working, startedAt: date(2)),
            makeItem(id: "finished", state: .finished, startedAt: date(3)),
            makeItem(id: "problem", state: .problem, startedAt: date(4)),
        ]

        XCTAssertEqual(
            ActivityFilter.allCases.map(\.title),
            ["All", "Needs you", "Working", "Finished", "Problems"]
        )
        XCTAssertEqual(
            ActivityFilter.allCases.map(\.accessibilityLabel),
            [
                "Show all activity",
                "Show activity that needs you",
                "Show working activity",
                "Show finished activity",
                "Show problems",
            ]
        )
        XCTAssertEqual(ActivityPresentation(items: items, filter: .all).items.count, 4)
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .needsYou).items.map(\.id),
            ["needs-you"]
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .working).items.map(\.id),
            ["working"]
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .finished).items.map(\.id),
            ["finished"]
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .problems).items.map(\.id),
            ["problem"]
        )
    }

    func testOrdersTheFeedByMostRecentStartAndKeepsInputOrderForTies() {
        let items = [
            makeItem(id: "older", state: .finished, startedAt: date(1)),
            makeItem(id: "newer-first", state: .working, startedAt: date(3)),
            makeItem(id: "newer-second", state: .problem, startedAt: date(3)),
            makeItem(id: "middle", state: .needsYou, startedAt: date(2)),
        ]

        let activity = ActivityPresentation(items: items, filter: .all)

        XCTAssertEqual(
            activity.items.map(\.id),
            ["newer-first", "newer-second", "middle", "older"]
        )
    }

    func testEmptyStateNamesTheActiveFilter() {
        XCTAssertEqual(
            ActivityPresentation(items: [], filter: .all).emptyStateExplanation,
            "Assistant activity will appear here."
        )
        XCTAssertEqual(
            ActivityPresentation(items: [], filter: .problems).emptyStateExplanation,
            "No problems match this filter."
        )
        XCTAssertTrue(ActivityPresentation(items: [], filter: .working).isEmpty)
    }

    private func makeItem(
        id: String,
        state: ActivityState,
        startedAt: Date
    ) -> ActivityItem {
        ActivityItem(
            id: id,
            assistantID: "assistant-1",
            assistantInstallationID: "machine-1:assistant-1",
            assistantMachineID: "machine-1",
            assistantName: "Weekly Report",
            conversationID: nil,
            state: state,
            headlineStatement: PresentationStatement(
                text: "Weekly Report ran",
                evidenceReferences: ["test.headline"]
            ),
            outcomeSummaryStatement: nil,
            startedAt: startedAt,
            endedAt: nil,
            primaryOutputStatement: nil,
            reviewReference: "/runs/\(id)/review",
            sourceReferences: ["test.source"]
        )
    }

    private func date(_ hour: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(hour * 3_600))
    }
}
