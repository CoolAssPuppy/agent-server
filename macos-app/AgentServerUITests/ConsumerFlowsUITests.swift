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
        XCTAssertTrue(text("Assistant saved").waitForExistence(timeout: 5))
        XCTAssertTrue(text("Your assistant is saved.").exists)
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
        XCTAssertTrue(reviewSheet.buttons["Save reviewed assistant"].exists)
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

    func testRunReviewLeadsWithOutcomeAndHidesTechnicalLanguage() {
        launch(scenario: "run-review")

        XCTAssertTrue(element("runReview.summary").waitForExistence(timeout: 5))
        XCTAssertTrue(text("Finished").exists)
        XCTAssertTrue(text("Weekly report finished").exists)
        XCTAssertTrue(text("Weekly report is ready").exists)
        XCTAssertTrue(text("Updated weekly-report.md").exists)
        XCTAssertTrue(text("What happened").exists)
        XCTAssertFalse(textContaining("mcp__").exists)
        XCTAssertFalse(textContaining("token").exists)

        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Run review outcome"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testTodayLeadsWithNeedsYouAndActivityUsesConsumerFilters() {
        launch(scenario: "today-activity")

        XCTAssertTrue(element("today.screen").waitForExistence(timeout: 5))
        XCTAssertTrue(text("Today").exists)
        XCTAssertTrue(text("Needs you").exists)
        XCTAssertTrue(text("Working").exists)
        XCTAssertTrue(text("Finished").exists)
        XCTAssertTrue(text("Problems").exists)
        XCTAssertTrue(text("Upcoming").exists)
        XCTAssertTrue(app.buttons["Choose"].exists)
        XCTAssertFalse(textContaining("mcp__").exists)
        XCTAssertFalse(textContaining("token").exists)

        app.buttons["Choose"].click()
        XCTAssertTrue(element("interaction.responseSheet").waitForExistence(timeout: 3))
        XCTAssertTrue(text("Choose what happens next").exists)
        XCTAssertTrue(text("Publish the draft").exists)
        XCTAssertTrue(text("Keep it as a draft").exists)
        XCTAssertFalse(element("interaction.submit").isEnabled)
        element("interaction.option.1").click()
        XCTAssertTrue(element("interaction.submit").isEnabled)
        app.sheets.firstMatch.buttons["Cancel"].click()

        element("mainNavigation.activity").click()
        XCTAssertTrue(element("activity.screen").waitForExistence(timeout: 3))
        XCTAssertTrue(element("activity.search").exists)
        XCTAssertTrue(text("History of work performed by agents on this Mac.").exists)
        XCTAssertTrue(text("Today").exists)
        XCTAssertTrue(element("activity.filter.all").exists)
        XCTAssertTrue(element("activity.filter.needsYou").exists)
        XCTAssertTrue(element("activity.filter.working").exists)
        XCTAssertTrue(element("activity.filter.finished").exists)
        XCTAssertTrue(element("activity.filter.problems").exists)

        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Today and Activity"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testAssistantHomeExplainsReadinessAccessAndResultsBeforeTechnicalDetails() {
        launch(scenario: "assistant-home")

        XCTAssertTrue(element("assistantHome.screen").waitForExistence(timeout: 5))
        XCTAssertTrue(text("Weekly Report").exists)
        XCTAssertTrue(text("Healthy").exists)
        XCTAssertTrue(text("Ready").exists)
        XCTAssertTrue(text("Run now").exists)
        XCTAssertEqual(app.buttons.matching(identifier: "assistantHome.primaryAction").count, 1)
        XCTAssertTrue(text("Schedule").exists)
        XCTAssertTrue(text("Access").exists)
        XCTAssertTrue(text("Connections").exists)
        XCTAssertTrue(text("Results").exists)
        XCTAssertTrue(text("Recent outcomes").exists)
        XCTAssertTrue(text("Advanced details").exists)
        XCTAssertFalse(textContaining("0 9 * * 1").exists)
        XCTAssertFalse(textContaining("machine-1").exists)

        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Assistant home"
        screenshot.lifetime = .keepAlways
        add(screenshot)
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
