import XCTest
@testable import AgentServerCore

final class RuntimeSelectionTests: XCTestCase {
    func testRestartIsRequiredWhenEitherRuntimeChoiceChanges() {
        let saved = RuntimeSelection(usesInstalledClaude: true, usesInstalledCodex: true)

        XCTAssertTrue(
            RuntimeSelection(usesInstalledClaude: false, usesInstalledCodex: true)
                .requiresRestart(comparedTo: saved)
        )
        XCTAssertTrue(
            RuntimeSelection(usesInstalledClaude: true, usesInstalledCodex: false)
                .requiresRestart(comparedTo: saved)
        )
    }

    func testRestartIsNotShownBeforeAChoiceChanges() {
        let saved = RuntimeSelection(usesInstalledClaude: true, usesInstalledCodex: false)
        XCTAssertFalse(saved.requiresRestart(comparedTo: saved))
    }
}
