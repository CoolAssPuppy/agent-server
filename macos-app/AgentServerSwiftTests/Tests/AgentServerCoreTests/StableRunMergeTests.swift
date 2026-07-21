import XCTest
@testable import AgentServerCore

final class StableRunMergeTests: XCTestCase {
    private struct RunFixture: Equatable {
        let id: String
        let source: String
        let isActive: Bool
    }

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

    func testRunsWithDifferentIDsNeverMatch() {
        let panel = run(id: "panel-run", source: "panel", isActive: true)
        let local = run(id: "local-run", source: "local", isActive: true)

        let merged = merge(panel: [panel], local: [local])

        XCTAssertEqual(merged, [local, panel])
    }

    func testDuplicatePanelIDsProduceOneStableOutputRow() {
        let firstPanel = run(id: "run-1", source: "panel-first", isActive: true)
        let secondPanel = run(id: "run-1", source: "panel-second", isActive: true)
        let local = run(id: "run-1", source: "local", isActive: true)

        let merged = merge(panel: [firstPanel, secondPanel], local: [local])

        XCTAssertEqual(merged, [local])
    }

    func testDuplicateLocalIDsKeepTheFirstRowAtItsOriginalPosition() {
        let first = run(id: "local-1", source: "local-first", isActive: true)
        let duplicate = run(id: "local-1", source: "local-duplicate", isActive: true)
        let second = run(id: "local-2", source: "local-second", isActive: false)

        let merged = merge(panel: [], local: [first, duplicate, second])

        XCTAssertEqual(merged, [first, second])
    }

    func testLocalOnlyRowsPrecedePanelRowsWithoutChangingEitherInputOrder() {
        let panelFirst = run(id: "panel-1", source: "panel-first", isActive: false)
        let panelSecond = run(id: "panel-2", source: "panel-second", isActive: false)
        let localFirst = run(id: "local-1", source: "local-first", isActive: true)
        let localSecond = run(id: "local-2", source: "local-second", isActive: false)

        let merged = merge(
            panel: [panelFirst, panelSecond],
            local: [localFirst, localSecond]
        )

        XCTAssertEqual(merged, [localFirst, localSecond, panelFirst, panelSecond])
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
            isActive: isActive
        )
    }
}
