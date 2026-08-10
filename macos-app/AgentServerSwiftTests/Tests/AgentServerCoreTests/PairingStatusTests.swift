import Foundation
import XCTest

@testable import AgentServerCore

/// Pairing, from the point of view of somebody who has just typed a code in
/// and restarted the app to see whether it took.
final class PairingStatusTests: XCTestCase {
    func testUnpairedMacHasNothingToSay() {
        let status = PairingStatus(paired: false, inUse: false)

        XCTAssertNil(PairingPresentation.summary(for: status))
        XCTAssertNil(PairingPresentation.detail(for: status))
    }

    func testPairedAndWorkingNamesTheMacPanelKnows() {
        let status = PairingStatus(
            paired: true,
            inUse: true,
            displayName: "Studio Mac"
        )

        XCTAssertEqual(
            PairingPresentation.summary(for: status),
            "Paired with Agent Panel as \"Studio Mac\"."
        )
    }

    func testPairedButNotYetInUseAsksForTheRestart() {
        // The gap between the two is the whole reason somebody stares at this
        // screen wondering whether pairing worked.
        let status = PairingStatus(
            paired: true,
            inUse: false,
            displayName: "Studio Mac"
        )

        let summary = PairingPresentation.summary(for: status)

        XCTAssertEqual(
            summary,
            "Paired as \"Studio Mac\", but not in use yet. Restart Agent Server to start using it."
        )
    }

    func testAMissingNameStillReadsAsASentence() {
        let status = PairingStatus(paired: true, inUse: true, displayName: "")

        XCTAssertEqual(
            PairingPresentation.summary(for: status),
            "Paired with Agent Panel as \"this Mac\"."
        )
    }

    func testDetailReportsWhenPairingHappened() {
        let status = PairingStatus(
            paired: true,
            inUse: true,
            displayName: "Studio Mac",
            pairedAt: "2026-08-10T06:11:20.322Z"
        )

        let detail = PairingPresentation.detail(
            for: status,
            now: Date(timeIntervalSince1970: 1_786_428_680)
        )

        XCTAssertNotNil(detail)
        XCTAssertTrue(detail!.hasPrefix("Paired "))
    }

    func testDetailStaysSilentOnATimestampItCannotRead() {
        let status = PairingStatus(
            paired: true,
            inUse: true,
            displayName: "Studio Mac",
            pairedAt: "yesterday afternoon"
        )

        XCTAssertNil(PairingPresentation.detail(for: status))
    }

    func testDecodesTheServerReplyAndCarriesNoCredential() throws {
        let json = Data("""
        {
          "paired": true,
          "in_use": false,
          "display_name": "Studio Mac",
          "org_id": "9f1f3c2a-0000-4000-8000-9f1f3c2a0001",
          "machine_id": "9f1f3c2a-0000-4000-8000-9f1f3c2a0002",
          "paired_at": "2026-08-10T06:11:20.322Z"
        }
        """.utf8)

        let status = try JSONDecoder().decode(PairingStatus.self, from: json)

        XCTAssertTrue(status.paired)
        XCTAssertFalse(status.inUse)
        XCTAssertEqual(status.displayName, "Studio Mac")
        XCTAssertEqual(status.machineID, "9f1f3c2a-0000-4000-8000-9f1f3c2a0002")
        XCTAssertEqual(status.pairedAt, "2026-08-10T06:11:20.322Z")
    }
}
