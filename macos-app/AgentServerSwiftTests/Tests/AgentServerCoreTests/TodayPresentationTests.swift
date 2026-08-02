import Foundation
import XCTest

@testable import AgentServerCore

final class TodayPresentationTests: XCTestCase {
    func testGroupsOnlyNonemptySectionsInTheConsumerReadingOrder() {
        let items = [
            makeItem(id: "upcoming", section: .upcoming, date: date(5)),
            makeItem(id: "problem", section: .problems, date: date(4)),
            makeItem(id: "finished", section: .finished, date: date(3)),
            makeItem(id: "working", section: .working, date: date(2)),
            makeItem(id: "needs-you", section: .needsYou, date: date(1)),
        ]

        let sections = TodayPresentation(items: items).sections

        XCTAssertEqual(
            sections.map(\.section),
            [.needsYou, .working, .finished, .problems, .upcoming]
        )
        XCTAssertEqual(
            sections.map(\.title),
            ["Needs you", "Working", "Finished", "Problems", "Upcoming"]
        )
        XCTAssertEqual(sections.flatMap(\.items).count, items.count)
    }

    func testOmitsEmptySectionsAndReportsACalmAllClearState() {
        let presentation = TodayPresentation(items: [
            makeItem(id: "finished", section: .finished, date: date(1)),
        ])

        XCTAssertEqual(presentation.sections.map(\.section), [.finished])
        XCTAssertFalse(presentation.isEmpty)
        XCTAssertEqual(presentation.emptyStateTitle, "You're all caught up")
        XCTAssertEqual(
            presentation.emptyStateExplanation,
            "Finished work and upcoming runs will appear here."
        )

        XCTAssertTrue(TodayPresentation(items: []).isEmpty)
    }

    func testNeedsYouWinsOverAProblemForTheSameSource() {
        let problem = makeItem(id: "decision-1", section: .problems, date: date(1))
        let request = makeItem(id: "decision-1", section: .needsYou, date: date(2))

        let sections = TodayPresentation(items: [problem, request]).sections

        XCTAssertEqual(sections.map(\.section), [.needsYou])
        XCTAssertEqual(sections.flatMap(\.items), [request])
    }

    func testWorkingWinsOverUpcomingForTheSameSource() {
        let upcoming = makeItem(id: "run-1", section: .upcoming, date: date(1))
        let working = makeItem(id: "run-1", section: .working, date: date(2))

        let sections = TodayPresentation(items: [upcoming, working]).sections

        XCTAssertEqual(sections.map(\.section), [.working])
        XCTAssertEqual(sections.flatMap(\.items), [working])
    }

    func testOrdersUpcomingSoonestFirstAndPastWorkNewestFirst() {
        let items = [
            makeItem(id: "upcoming-later", section: .upcoming, date: date(5)),
            makeItem(id: "finished-older", section: .finished, date: date(1)),
            makeItem(id: "upcoming-sooner", section: .upcoming, date: date(3)),
            makeItem(id: "finished-newer", section: .finished, date: date(4)),
        ]

        let sections = TodayPresentation(items: items).sections

        XCTAssertEqual(
            sections.first(where: { $0.section == .finished })?.items.map(\.id),
            ["finished-newer", "finished-older"]
        )
        XCTAssertEqual(
            sections.first(where: { $0.section == .upcoming })?.items.map(\.id),
            ["upcoming-sooner", "upcoming-later"]
        )
    }

    func testOrdersNeedsYouByTheSoonestKnownExpiry() {
        let items = [
            makeItem(id: "later", section: .needsYou, date: date(1), expiresAt: date(6)),
            makeItem(id: "no-expiry", section: .needsYou, date: date(4)),
            makeItem(id: "sooner", section: .needsYou, date: date(2), expiresAt: date(3)),
        ]

        let needsYou = TodayPresentation(items: items).sections.first?.items

        XCTAssertEqual(needsYou?.map(\.id), ["sooner", "later", "no-expiry"])
    }

    private func makeItem(
        id: String,
        section: TodaySection,
        date: Date,
        expiresAt: Date? = nil
    ) -> TodayItem {
        TodayItem(
            id: id,
            assistantID: "assistant-1",
            assistantName: "Weekly Report",
            section: section,
            headline: "Weekly Report has an update",
            explanation: "Review the latest result.",
            date: date,
            expiresAt: expiresAt,
            primaryAction: "Review"
        )
    }

    private func date(_ hour: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(hour * 3_600))
    }
}
