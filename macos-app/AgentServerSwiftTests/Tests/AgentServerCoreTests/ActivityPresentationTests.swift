import Foundation
import XCTest

@testable import AgentServerCore

final class ActivityPresentationTests: XCTestCase {
    func testToolbarUsesFullFilterLabelsUntilSearchExpands() {
        let collapsed = ActivityToolbarPresentation(isSearchExpanded: false)
        let expanded = ActivityToolbarPresentation(isSearchExpanded: true)

        XCTAssertEqual(collapsed.subtitle, "History of work performed by assistants on this Mac.")
        XCTAssertEqual(
            collapsed.filterLabels,
            ["All", "Needs you", "Working", "Finished", "Problems"]
        )
        XCTAssertEqual(expanded.filterLabels, ["A", "N", "W", "F", "P"])
        XCTAssertEqual(
            expanded.filterAccessibilityLabels,
            collapsed.filterAccessibilityLabels
        )
    }

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

    func testSearchMatchesAssistantOutcomeSummaryAndOutputWithoutChangingStateFiltering() {
        let items = [
            makeItem(
                id: "release",
                state: .finished,
                startedAt: date(3),
                assistantName: "Release notes",
                headline: "Published version 2.0",
                summary: "Prepared the customer summary",
                output: "release-notes.md"
            ),
            makeItem(
                id: "backup",
                state: .problem,
                startedAt: date(2),
                assistantName: "Backup check",
                headline: "Could not reach the archive"
            ),
        ]

        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .all, searchText: "customer").items.map(\.id),
            ["release"]
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .problems, searchText: "release").items,
            []
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .problems, searchText: "release")
                .emptyStateExplanation,
            "No activity matches your search."
        )
        XCTAssertEqual(
            ActivityPresentation(items: items, filter: .all, searchText: "  RELEASE-NOTES  ").items.map(\.id),
            ["release"]
        )
    }

    func testGroupsHistoryByCalendarDayWithCurrentDayLabels() {
        let calendar = Calendar(identifier: .gregorian)
        let referenceDate = Date(timeIntervalSince1970: 10 * 86_400 + 12 * 3_600)
        let items = [
            makeItem(id: "today", state: .working, startedAt: referenceDate),
            makeItem(id: "yesterday", state: .finished, startedAt: referenceDate.addingTimeInterval(-86_400)),
            makeItem(id: "earlier", state: .problem, startedAt: referenceDate.addingTimeInterval(-3 * 86_400)),
        ]

        let groups = ActivityPresentation(items: items, filter: .all)
            .groups(referenceDate: referenceDate, calendar: calendar)

        XCTAssertEqual(groups.map(\.title).prefix(2), ["Today", "Yesterday"])
        XCTAssertEqual(groups.map { $0.items.map(\.id) }, [["today"], ["yesterday"], ["earlier"]])
    }

    private func makeItem(
        id: String,
        state: ActivityState,
        startedAt: Date,
        assistantName: String = "Weekly Report",
        headline: String = "Weekly Report ran",
        summary: String? = nil,
        output: String? = nil
    ) -> ActivityItem {
        ActivityItem(
            id: id,
            assistantID: "assistant-1",
            assistantInstallationID: "machine-1:assistant-1",
            assistantMachineID: "machine-1",
            assistantName: assistantName,
            conversationID: nil,
            state: state,
            headlineStatement: PresentationStatement(
                text: headline,
                evidenceReferences: ["test.headline"]
            ),
            outcomeSummaryStatement: summary.map {
                PresentationStatement(text: $0, evidenceReferences: ["test.summary"])
            },
            startedAt: startedAt,
            endedAt: nil,
            primaryOutputStatement: output.map {
                PresentationStatement(text: $0, evidenceReferences: ["test.output"])
            },
            reviewReference: "/runs/\(id)/review",
            sourceReferences: ["test.source"]
        )
    }

    private func date(_ hour: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(hour * 3_600))
    }
}
