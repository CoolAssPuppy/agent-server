import XCTest
@testable import AgentServerCore

final class ConnectionScreenPresentationTests: XCTestCase {
    func testPrimaryConnectionSectionsUseSentenceCaseConsumerCopy() {
        XCTAssertEqual(
            ConnectionScreenSection.primary.map(\.title),
            ["Your connections", "Available through Claude", "Messaging"]
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
