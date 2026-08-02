import XCTest

@testable import AgentServerCore

final class MainDestinationTests: XCTestCase {
    func testTodayIsTheDefaultAndConsumerDestinationsHaveAStableOrder() {
        XCTAssertEqual(MainDestination.defaultDestination, .today)
        XCTAssertEqual(
            MainDestination.allCases,
            [.today, .assistants, .activity, .connections, .settings]
        )
    }

    func testDesktopBarKeepsConnectionsAsAStableLabeledDestination() {
        XCTAssertEqual(
            MainDestination.desktopBarDestinations,
            [.today, .activity, .connections]
        )
    }

    func testDestinationsUseDirectConsumerLabelsAndAccessibleIdentifiers() {
        let presentations = MainDestination.allCases.map {
            ($0.title, $0.systemImage, $0.accessibilityIdentifier)
        }

        XCTAssertEqual(
            presentations.map(\.0),
            ["Today", "Agents", "Activity", "Connections", "Settings"]
        )
        XCTAssertEqual(
            presentations.map(\.1),
            ["sun.max", "person.2", "clock.arrow.circlepath", "link", "gearshape"]
        )
        XCTAssertEqual(
            presentations.map(\.2),
            [
                "mainNavigation.today",
                "mainNavigation.assistants",
                "mainNavigation.activity",
                "mainNavigation.connections",
                "mainNavigation.settings",
            ]
        )
        XCTAssertEqual(MainDestination.allCases.map(\.accessibilityLabel), presentations.map(\.0))
    }
}
