import XCTest
@testable import AgentServerCore

final class ConnectionScreenPresentationTests: XCTestCase {
    func testRuntimeRowsShowInstallationWithoutClaimingAuthentication() throws {
        let rows = [
            RuntimeConnection(id: "claude-code", label: "Claude Code", installed: true, authentication: "unknown"),
            RuntimeConnection(id: "codex", label: "Codex", installed: true, authentication: "unknown"),
            RuntimeConnection(id: "kimi-code", label: "Kimi Code", installed: false, authentication: "unknown"),
        ].map(RuntimeConnectionPresentation.init)

        XCTAssertEqual(rows.map(\.name), ["Claude Code", "Codex", "Kimi Code"])
        XCTAssertEqual(rows.map(\.status), [.installed, .installed, .notInstalled])
        XCTAssertTrue(rows.allSatisfy { $0.authenticationSummary == "Sign-in checked when an agent runs" })
    }

    func testClaudeDiscoverySeparatesCheckingFailureAndSuccessfulEmptyStates() {
        XCTAssertEqual(
            ClaudeConnectionDiscoveryPresentation(
                discoveredAt: nil,
                didProbeFail: false,
                connectionCount: 0
            ).emptyMessage,
            "Checking connections from Claude Code…"
        )
        XCTAssertEqual(
            ClaudeConnectionDiscoveryPresentation(
                discoveredAt: nil,
                didProbeFail: true,
                connectionCount: 0
            ).emptyMessage,
            "Could not check Claude connections. Try again."
        )
        XCTAssertEqual(
            ClaudeConnectionDiscoveryPresentation(
                discoveredAt: "2026-08-02T08:00:00.000Z",
                didProbeFail: false,
                connectionCount: 0
            ).emptyMessage,
            "No Claude connections found yet. Connect an app in Claude Code, then refresh."
        )
    }

    func testPrimaryConnectionSectionsUseSentenceCaseConsumerCopy() {
        XCTAssertEqual(
            ConnectionScreenSection.primary.map(\.title),
            ["Your connections", "AI engines", "Available through Claude", "Messaging"]
        )
        XCTAssertEqual(
            ConnectionScreenSection.saved.explanation,
            "Accounts and tools you have set up for Agent Server."
        )
    }

    func testConnectionTemplatesRemainAnAdvancedSection() {
        XCTAssertEqual(ConnectionScreenSection.advanced, [.templates])
        XCTAssertEqual(ConnectionScreenSection.templates.title, "Advanced connections")
        XCTAssertTrue(ConnectionScreenSection.templates.isAdvanced)
    }

    func testConnectionSetupKeepsTechnicalControlBehindDisclosure() {
        XCTAssertEqual(
            ConnectionSetupSection.visible.map(\.title),
            ["Connection name", "How it connects", "Credentials"]
        )
        XCTAssertEqual(ConnectionSetupSection.technical.title, "Technical details")
        XCTAssertTrue(ConnectionSetupSection.technical.isAdvanced)
    }

    func testCustomConnectionSetupIsExplicitlyAdvanced() {
        XCTAssertEqual(ConnectionSetupSection.introductionTitle, "Add advanced connection")
        XCTAssertEqual(
            ConnectionSetupSection.introductionExplanation,
            "Set up a custom web endpoint or local command. Most people can connect apps through Claude or use a service template instead."
        )
    }
}
