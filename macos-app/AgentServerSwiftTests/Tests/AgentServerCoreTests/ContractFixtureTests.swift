import Foundation
import XCTest

@testable import AgentServerCore

/// The other half of the wire contract.
///
/// The server proves it still answers the shapes in contracts/
/// (contract-fixtures.test.ts). This proves the app's models still read
/// them. Between the two, a field rename on either side fails CI instead of
/// failing on somebody's Mac as "The data couldn't be read".
final class ContractFixtureTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        // Tests/AgentServerCoreTests -> Tests -> AgentServerSwiftTests
        // -> macos-app -> repo root.
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try Data(contentsOf: root
            .appendingPathComponent("contracts")
            .appendingPathComponent("\(name).json"))
    }

    /// The same configuration AgentServerClient uses, so this test exercises
    /// what ships rather than a friendlier decoder.
    private var clientDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    func testHealthContractDecodes() throws {
        let health = try clientDecoder.decode(HealthResponse.self, from: fixture("health"))

        XCTAssertEqual(health.status, "ok")
        XCTAssertNotNil(health.serverVersion)
        XCTAssertEqual(health.panel?.state, .failing)
    }

    func testMachineContractDecodes() throws {
        let machine = try clientDecoder.decode(MachineResponse.self, from: fixture("machine"))

        XCTAssertFalse(machine.machineId.isEmpty)
        XCTAssertEqual(machine.protocolVersion, 2)
    }

    func testPairingStatusContractDecodes() throws {
        let status = try clientDecoder.decode(PairingStatus.self, from: fixture("pair-status"))

        XCTAssertTrue(status.paired)
        XCTAssertEqual(status.displayName, "Contract Mac")
    }

    func testPairingRedeemContractDecodes() throws {
        let redeem = try clientDecoder.decode(PairingResponse.self, from: fixture("pair-redeem"))

        XCTAssertTrue(redeem.ok)
        XCTAssertEqual(redeem.displayName, "Contract Mac")
    }

    func testTriggerContractDecodes() throws {
        let trigger = try clientDecoder.decode(TriggerResponse.self, from: fixture("trigger-run"))

        XCTAssertFalse(trigger.runId.isEmpty)
        XCTAssertFalse(trigger.agentId.isEmpty)
    }

    func testCleanupContractDecodes() throws {
        let cleanup = try clientDecoder.decode(CleanupResponse.self, from: fixture("cleanup"))

        XCTAssertTrue(cleanup.ok)
    }

    func testRunContractDecodes() throws {
        let run = try clientDecoder.decode(Run.self, from: fixture("run"))

        XCTAssertEqual(run.runId, "run-contract")
        XCTAssertEqual(run.status, .completed)
        // The optional tail of the model, present in the fixture on purpose:
        // absent-in-fixture is indistinguishable from renamed-on-the-wire.
        XCTAssertNotNil(run.completedAt)
        XCTAssertNotNil(run.inputTokens)
        XCTAssertNotNil(run.conversationId)
    }

    func testSecurityAnalysisContractDecodes() throws {
        let analysis = try clientDecoder.decode(
            SecurityAnalysisPayload.self,
            from: fixture("security-analysis")
        )

        XCTAssertEqual(analysis.agentId, "reader")
        XCTAssertFalse(analysis.findings.isEmpty)
        XCTAssertNotNil(analysis.reviewState)
        XCTAssertNotNil(analysis.automaticRuns)
    }
}
