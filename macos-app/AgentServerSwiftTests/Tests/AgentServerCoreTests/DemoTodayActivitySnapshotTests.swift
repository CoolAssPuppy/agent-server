import Foundation
import XCTest

@testable import AgentServerCore

final class DemoTodayActivitySnapshotTests: XCTestCase {
    func testBuildsARepeatableSnapshotWithEveryConsumerState() {
        let referenceDate = Date(timeIntervalSince1970: 1_754_132_400)

        let first = DemoTodayActivitySnapshot.make(referenceDate: referenceDate)
        let second = DemoTodayActivitySnapshot.make(referenceDate: referenceDate)

        XCTAssertEqual(first, second)
        XCTAssertEqual(
            first.makeTodayPresentation().sections.map(\.section),
            [.needsYou, .working, .finished, .problems, .upcoming]
        )
        XCTAssertEqual(
            first.makeActivityPresentation(filter: .all).items.map(\.state),
            [.needsYou, .working, .finished, .problem]
        )
        let needsYouAction = try? XCTUnwrap(
            first.makeTodayPresentation().sections.first?.items.first?.primaryAction
        )
        XCTAssertEqual(needsYouAction?.kind, .respond)
        XCTAssertEqual(needsYouAction?.label, "Choose")
    }
}
