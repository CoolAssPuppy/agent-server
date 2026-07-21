import XCTest
@testable import AgentServerCore

final class RuntimeSelectionTests: XCTestCase {
    func testRestartIsRequiredWhenKimiDiscoveryChanges() {
        let saved = RuntimeSelection(usesInstalledKimi: true)

        XCTAssertTrue(
            RuntimeSelection(usesInstalledKimi: false)
                .requiresRestart(comparedTo: saved)
        )
    }

    func testRestartIsNotShownBeforeAChoiceChanges() {
        let saved = RuntimeSelection(usesInstalledKimi: true)
        XCTAssertFalse(saved.requiresRestart(comparedTo: saved))
    }
}
