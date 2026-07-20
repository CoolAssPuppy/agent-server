import XCTest

final class ConsumerFlowsUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
    }

    override func tearDown() {
        app?.terminate()
        app = nil
        super.tearDown()
    }

    func testCreatesReadOnlyScheduledAgentWithMissingConnectionAndRunsSafeTest() {
        launch(scenario: "creation")

        let request = element("creation.request")
        XCTAssertTrue(request.waitForExistence(timeout: 5))
        request.click()
        request.typeText("Every Friday afternoon, review my GitHub activity and send a short summary in Slack.")
        element("creation.continue").click()

        XCTAssertTrue(element("creation.review").waitForExistence(timeout: 5))
        XCTAssertTrue(textContaining("Every Friday at 5:00 PM").exists)
        XCTAssertTrue(textContaining("Needs setup").exists)
        XCTAssertTrue(app.buttons["Set up Slack"].exists)
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(textContaining("Read-only").waitForExistence(timeout: 3))

        element("creation.saveAndTest").click()
        XCTAssertTrue(text("Agent saved").waitForExistence(timeout: 5))
        XCTAssertTrue(text("Your agent is ready.").exists)
    }

    func testDebuggerReviewsLowRiskFixAndPreservesFailedRunDuringRetry() {
        launch(scenario: "debugger")

        XCTAssertTrue(text("This agent could not save its report.").waitForExistence(timeout: 5))
        XCTAssertTrue(text("File editing is currently turned off.").exists)
        element("debugger.reviewFix").click()

        XCTAssertTrue(text("Allow edits in Documents/Reports").waitForExistence(timeout: 3))
        element("debugger.applyFix").click()

        XCTAssertTrue(textContaining("Trying again").waitForExistence(timeout: 5))
        XCTAssertTrue(textContaining("The original failed run is preserved in run history.").exists)
    }

    func testSecurityCheckDetectsSecretAndNarrowsBroadFolderAccess() {
        launch(scenario: "security")

        XCTAssertTrue(text("A secret appears in the agent file").waitForExistence(timeout: 5))
        XCTAssertTrue(text("This agent can edit your entire home folder").exists)

        let broadFix = app.buttons
            .matching(identifier: "security.finding.broad-home")
            .matching(NSPredicate(format: "label == %@", "Review fix"))
            .firstMatch
        XCTAssertTrue(broadFix.exists)
        broadFix.click()
        let applyFix = app.sheets.firstMatch.buttons["Apply reviewed fix"]
        XCTAssertTrue(applyFix.waitForExistence(timeout: 3))
        applyFix.click()

        XCTAssertFalse(text("This agent can edit your entire home folder").waitForExistence(timeout: 2))
        XCTAssertTrue(text("A secret appears in the agent file").exists)
    }

    func testHighRiskAgentRequiresExplicitReviewBeforeSaving() {
        launch(scenario: "high-risk-creation")

        let request = element("creation.request")
        XCTAssertTrue(request.waitForExistence(timeout: 5))
        request.click()
        request.typeText("Run commands and post the result online.")
        element("creation.continue").click()
        XCTAssertTrue(textContaining("High risk").waitForExistence(timeout: 5))

        element("creation.saveAndTest").click()
        let reviewSheet = app.sheets.firstMatch
        XCTAssertTrue(reviewSheet.waitForExistence(timeout: 3))
        XCTAssertTrue(reviewSheet.buttons["Save reviewed agent"].exists)
        reviewSheet.buttons["Cancel"].click()
        XCTAssertTrue(element("creation.saveAndTest").exists)
    }

    func testSelectsCodexFromTheRuntimeCardsBeforeReview() {
        launch(scenario: "runtime-creation")

        let request = element("creation.request")
        XCTAssertTrue(request.waitForExistence(timeout: 5))
        request.click()
        request.typeText("Review my selected files.")
        element("creation.continue").click()

        let codex = element("creation.runtime.codex")
        XCTAssertTrue(codex.waitForExistence(timeout: 5))
        XCTAssertTrue(element("creation.runtime.claude-code").exists)
        XCTAssertTrue(element("creation.runtime.kimi-code").exists)
        XCTAssertFalse(element("creation.runtime.kimi-code").isEnabled)

        codex.click()
        XCTAssertEqual(codex.value as? String, "Selected")
        element("creation.continue").click()

        XCTAssertTrue(element("creation.review").waitForExistence(timeout: 5))
    }

    private func launch(scenario: String) {
        app.launchEnvironment["AGENT_SERVER_UI_TEST_SCENARIO"] = scenario
        app.launch()
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func text(_ value: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(
            format: "label == %@ OR value == %@",
            value,
            value
        )).firstMatch
    }

    private func textContaining(_ value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ OR value CONTAINS %@",
            value,
            value
        )).firstMatch
    }
}
