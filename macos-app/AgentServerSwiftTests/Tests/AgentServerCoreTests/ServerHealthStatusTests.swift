import Foundation
import XCTest

@testable import AgentServerCore

final class ServerHealthStatusTests: XCTestCase {
    func testDecodesTheHealthPayloadFields() throws {
        let json = Data("""
        {
          "state": "failing",
          "last_success_at": "2026-08-10T06:00:00.000Z",
          "last_failure_at": "2026-08-10T06:09:00.000Z",
          "last_failure": "HTTP 401",
          "consecutive_failures": 12
        }
        """.utf8)

        let status = try JSONDecoder().decode(PanelReportingStatus.self, from: json)

        XCTAssertEqual(status.state, .failing)
        XCTAssertEqual(status.lastFailure, "HTTP 401")
        XCTAssertEqual(status.consecutiveFailures, 12)
    }

    func testSaysNothingWhileReportingWorks() {
        XCTAssertNil(ServerHealthPresentation.panelReportingWarning(
            for: PanelReportingStatus(state: .ok)
        ))
        XCTAssertNil(ServerHealthPresentation.panelReportingWarning(
            for: PanelReportingStatus(state: .unknown)
        ))
    }

    func testNamesTheFailureAndHowLongPanelHasBeenDeaf() {
        let status = PanelReportingStatus(
            state: .failing,
            lastSuccessAt: "2026-08-10T06:00:00.000Z",
            lastFailureAt: "2026-08-10T06:09:00.000Z",
            lastFailure: "HTTP 401",
            consecutiveFailures: 12
        )

        let warning = ServerHealthPresentation.panelReportingWarning(for: status)

        XCTAssertNotNil(warning)
        XCTAssertTrue(warning!.contains("HTTP 401"))
        XCTAssertTrue(warning!.contains("last heard from this Mac"))
    }

    func testFailingWithNoPriorSuccessStillWarns() {
        // A server that has never delivered once -- wrong key from day one --
        // is the worst case, and it must not read as fine.
        let status = PanelReportingStatus(
            state: .failing,
            lastFailure: "HTTP 401",
            consecutiveFailures: 5
        )

        let warning = ServerHealthPresentation.panelReportingWarning(for: status)

        XCTAssertEqual(warning, "Runs are not reaching Agent Panel (HTTP 401).")
    }

    func testMatchingVersionsRaiseNoWarning() {
        XCTAssertNil(ServerHealthPresentation.versionSkewWarning(
            appVersion: "3.7.6", serverVersion: "3.7.6"
        ))
        // An old server that does not report a version cannot be compared,
        // and guessing would warn on every pre-3.7.6 install.
        XCTAssertNil(ServerHealthPresentation.versionSkewWarning(
            appVersion: "3.7.6", serverVersion: nil
        ))
    }

    func testAStaleServerIsNamedWithBothVersions() {
        let warning = ServerHealthPresentation.versionSkewWarning(
            appVersion: "3.7.6", serverVersion: "3.7.2"
        )

        XCTAssertNotNil(warning)
        XCTAssertTrue(warning!.contains("3.7.6"))
        XCTAssertTrue(warning!.contains("3.7.2"))
        XCTAssertTrue(warning!.contains("AGENT_SERVER_LOCATION"))
    }
}
