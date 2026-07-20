import XCTest
@testable import AgentServerCore

final class RuntimeSelectionTests: XCTestCase {
    func testRestartIsRequiredWhenAnyRuntimeChoiceChanges() {
        let saved = RuntimeSelection(
            usesInstalledClaude: true,
            usesInstalledCodex: true,
            usesInstalledKimi: true
        )

        XCTAssertTrue(
            RuntimeSelection(
                usesInstalledClaude: false,
                usesInstalledCodex: true,
                usesInstalledKimi: true
            )
                .requiresRestart(comparedTo: saved)
        )
        XCTAssertTrue(
            RuntimeSelection(
                usesInstalledClaude: true,
                usesInstalledCodex: false,
                usesInstalledKimi: true
            )
                .requiresRestart(comparedTo: saved)
        )
        XCTAssertTrue(
            RuntimeSelection(
                usesInstalledClaude: true,
                usesInstalledCodex: true,
                usesInstalledKimi: false
            )
                .requiresRestart(comparedTo: saved)
        )
    }

    func testRestartIsNotShownBeforeAChoiceChanges() {
        let saved = RuntimeSelection(
            usesInstalledClaude: true,
            usesInstalledCodex: false,
            usesInstalledKimi: true
        )
        XCTAssertFalse(saved.requiresRestart(comparedTo: saved))
    }
}
