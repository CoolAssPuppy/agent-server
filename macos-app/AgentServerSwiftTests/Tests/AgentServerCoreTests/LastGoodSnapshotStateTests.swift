import XCTest

@testable import AgentServerCore

final class LastGoodSnapshotStateTests: XCTestCase {
    func testRetainsTheLastSuccessfulSnapshotWhenARefreshFails() {
        var state = LastGoodSnapshotState<String>()

        XCTAssertNil(state.resolve(nil))
        XCTAssertEqual(state.resolve("first snapshot"), "first snapshot")
        XCTAssertEqual(state.resolve(nil), "first snapshot")
        XCTAssertEqual(state.resolve("newer snapshot"), "newer snapshot")
    }
}
