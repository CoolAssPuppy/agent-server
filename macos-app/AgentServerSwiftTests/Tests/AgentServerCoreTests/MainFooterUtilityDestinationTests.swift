import XCTest

@testable import AgentServerCore

final class MainFooterUtilityDestinationTests: XCTestCase {
    func testFooterOrderIsSecurityThenConnectionsThenSettings() {
        XCTAssertEqual(
            MainFooterUtilityDestination.allCases,
            [.security, .connections, .settings]
        )
    }

    func testEveryFooterIconHasATitleAndSymbol() {
        for destination in MainFooterUtilityDestination.allCases {
            XCTAssertFalse(destination.title.isEmpty)
            XCTAssertFalse(destination.systemImage.isEmpty)
            XCTAssertFalse(destination.accessibilityIdentifier.isEmpty)
        }
    }
}
