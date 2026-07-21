import XCTest
@testable import AgentServerCore

final class StableRunMergeTests: XCTestCase {
    private struct RunFixture: Equatable {
        let id: String
        let source: String
        let isActive: Bool
        let startedAt: Date
    }

    private let referenceDate = Date(timeIntervalSince1970: 1_700_000_000)

    func testActivePanelRunUsesLocalStateWithTheSameRunID() {
        let panel = run(id: "run-1", source: "panel", isActive: true)
        let local = run(id: "run-1", source: "local", isActive: true)

        let merged = merge(panel: [panel], local: [local])

        XCTAssertEqual(merged, [local])
    }

    func testTerminalPanelRunKeepsPanelResultWithTheSameRunID() {
        let panel = run(id: "run-1", source: "panel", isActive: false)
        let local = run(id: "run-1", source: "local", isActive: true)

        let merged = merge(panel: [panel], local: [local])

        XCTAssertEqual(merged, [panel])
    }

    func testRunsWithDifferentIDsNeverMatchEvenWhenTheirStartTimesAreEqual() {
        let panel = run(id: "panel-run", source: "panel", isActive: true)
        let local = run(id: "local-run", source: "local", isActive: true)

        let merged = merge(panel: [panel], local: [local])

        XCTAssertEqual(merged, [local, panel])
    }

    func testOneLocalRunCannotReplaceSeveralPanelRows() {
        let firstPanel = run(id: "run-1", source: "panel-first", isActive: true)
        let secondPanel = run(id: "run-1", source: "panel-second", isActive: true)
        let local = run(id: "run-1", source: "local", isActive: true)

        let merged = merge(panel: [firstPanel, secondPanel], local: [local])

        XCTAssertEqual(merged, [local, secondPanel])
    }

    func testLocalOnlyRunIDsAreIncludedOnceInTheirOriginalOrder() {
        let firstVersion = run(id: "local-1", source: "local-old", isActive: true)
        let latestVersion = run(id: "local-1", source: "local-new", isActive: true)
        let second = run(id: "local-2", source: "local-second", isActive: false)

        let merged = merge(panel: [], local: [firstVersion, latestVersion, second])

        XCTAssertEqual(merged, [latestVersion, second])
    }

    private func merge(panel: [RunFixture], local: [RunFixture]) -> [RunFixture] {
        StableRunMerge.merge(
            panel: panel,
            local: local,
            id: \RunFixture.id,
            isActive: \RunFixture.isActive
        )
    }

    private func run(id: String, source: String, isActive: Bool) -> RunFixture {
        RunFixture(
            id: id,
            source: source,
            isActive: isActive,
            startedAt: referenceDate
        )
    }
}
