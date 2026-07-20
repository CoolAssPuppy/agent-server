import XCTest
@testable import AgentServerCore

final class AgentTriggerPresentationTests: XCTestCase {
    func testRunControlUsesNativeActionsAndFlatSelectableFeedback() {
        let presentation = AgentRunControlSupportingSurfacePresentation()

        XCTAssertEqual(presentation.primaryActionStyle, .borderedProminent)
        XCTAssertEqual(presentation.pausedStatusStyle, .secondaryText)
        XCTAssertEqual(presentation.feedbackStyle, .flat)
        XCTAssertTrue(presentation.isFeedbackSelectable)
        XCTAssertTrue(presentation.supportsReducedMotion)
    }

    func testScheduledAgentUsesCronDescription() {
        let presentation = AgentTriggerPresentation(schedule: "0 9 * * *", hasWatch: false)

        XCTAssertEqual(presentation.kind, .scheduled)
        XCTAssertEqual(presentation.fallbackLabel, nil)
    }

    func testWatchOnlyAgentUsesFileWatchLabel() {
        let presentation = AgentTriggerPresentation(schedule: nil, hasWatch: true)

        XCTAssertEqual(presentation.kind, .watcher)
        XCTAssertEqual(presentation.fallbackLabel, "File watch")
    }

    func testOnDemandAgentUsesOnDemandLabel() {
        let presentation = AgentTriggerPresentation(schedule: nil, hasWatch: false)

        XCTAssertEqual(presentation.kind, .onDemand)
        XCTAssertEqual(presentation.fallbackLabel, "On demand")
    }

    func testAllNonRunningDefinitionsRemainAvailableRegardlessOfTriggerOrEnabledState() {
        let available = AgentCatalogPresentation.availableAgentIds(
            agentIds: ["scheduled", "watch-only", "on-demand", "disabled"],
            runningAgentIds: ["scheduled"]
        )

        XCTAssertEqual(available, ["watch-only", "on-demand", "disabled"])
    }

    func testStartedRunCanBeOpenedByItsExactIdentifier() {
        let state = AgentRunTriggerState.started(runId: "run-123")

        XCTAssertEqual(state.startedRunId, "run-123")
        XCTAssertEqual(state.presentation?.title, "Run started")
        XCTAssertEqual(state.presentation?.recovery, .openRun)
        XCTAssertEqual(state.presentation?.recoveryTitle, "Open run")
    }

    func testOfflineFailureExplainsThatNothingRanAndOffersRetry() {
        let presentation = AgentRunTriggerState.failure(.offline).presentation

        XCTAssertEqual(presentation?.title, "Agent Server is offline")
        XCTAssertEqual(presentation?.message, "Nothing was run. Start Agent Server, then try again.")
        XCTAssertEqual(presentation?.recovery, .retry)
        XCTAssertEqual(presentation?.recoveryTitle, "Try again")
    }

    func testMissingConnectionUsesConsumerLanguageWithoutTechnicalNames() {
        let presentation = AgentRunTriggerState.failure(.missingConnection).presentation

        XCTAssertEqual(presentation?.title, "Connect an app or service")
        XCTAssertEqual(presentation?.message, "Nothing was run. This agent needs a connection before it can start.")
        XCTAssertEqual(presentation?.recovery, .openAgentSettings)
        XCTAssertEqual(presentation?.recoveryTitle, "Open agent settings")
        XCTAssertFalse(presentation?.message.contains("environment") == true)
    }

    func testSecurityReviewRoutesToExistingSecurityCheck() {
        let presentation = AgentRunTriggerState.failure(.securityReview).presentation

        XCTAssertEqual(presentation?.title, "Review security before running")
        XCTAssertEqual(presentation?.recovery, .reviewSecurity)
        XCTAssertEqual(presentation?.recoveryTitle, "Review security")
    }

    func testBlockedSecurityFailureExplainsThatSetupMustChange() {
        let presentation = AgentRunTriggerState.failure(.securityBlocked).presentation

        XCTAssertEqual(presentation?.title, "This agent needs a safer setup")
        XCTAssertEqual(presentation?.message, "Nothing was run. Security check found a critical issue that must be reviewed.")
        XCTAssertEqual(presentation?.recovery, .reviewSecurity)
    }

    func testGenericFailureStaysActionableWithoutShowingRawServerDetails() {
        let presentation = AgentRunTriggerState.failure(.generic).presentation

        XCTAssertEqual(presentation?.title, "Run could not start")
        XCTAssertEqual(presentation?.message, "Nothing was run. Try again, or review the agent's settings.")
        XCTAssertEqual(presentation?.recovery, .retry)
    }

    func testStartingStatePreventsDuplicateRunRequests() {
        XCTAssertTrue(AgentRunTriggerState.starting.isStarting)
        XCTAssertFalse(AgentRunTriggerState.idle.isStarting)
        XCTAssertNil(AgentRunTriggerState.starting.presentation)
    }

    func testTriggerFailureClassificationUsesStructuredServerCodes() {
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(serverCode: "review_required"),
            .securityReview
        )
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(serverCode: "confirmation_required"),
            .securityReview
        )
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(serverCode: "content_changed"),
            .securityReview
        )
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(serverCode: "blocked"),
            .securityBlocked
        )
    }

    func testMissingConnectionTakesPriorityOverGenericServerFailure() {
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(
                serverCode: nil,
                hasMissingConnection: true
            ),
            .missingConnection
        )
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(serverCode: "missing_connection"),
            .missingConnection
        )
    }

    func testUnavailableSecurityCheckRoutesToSecurityReview() {
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(
                serverCode: nil,
                serverMessage: "Security check is unavailable. Nothing was run."
            ),
            .securityReview
        )
    }

    func testTransportFailureRoutesToOfflineFeedback() {
        XCTAssertEqual(
            AgentRunTriggerFailure.classify(
                serverCode: nil,
                isTransportFailure: true
            ),
            .offline
        )
    }

    func testRequestTimeoutSaysTheRunMayStillStartInsteadOfClaimingOffline() {
        let failure = AgentRunTriggerFailure.classify(
            serverCode: nil,
            isTransportFailure: true,
            isRequestTimeout: true
        )
        let presentation = AgentRunTriggerState.failure(failure).presentation

        XCTAssertEqual(failure, .takingLonger)
        XCTAssertEqual(presentation?.title, "The safety check is taking longer")
        XCTAssertEqual(presentation?.recovery, .checkStatus)
        XCTAssertFalse(presentation?.message.contains("Nothing was run") == true)
        XCTAssertFalse(presentation?.message.contains("offline") == true)
    }

    func testReconciliationFindsTheNewestMatchingRunStartedAfterTheRequest() {
        let requestedAt = Date(timeIntervalSince1970: 100)
        let candidates = [
            AgentRunCandidate(runId: "old", agentId: "writer", startedAt: Date(timeIntervalSince1970: 90)),
            AgentRunCandidate(runId: "other", agentId: "other", startedAt: Date(timeIntervalSince1970: 110)),
            AgentRunCandidate(runId: "first", agentId: "writer", startedAt: Date(timeIntervalSince1970: 105)),
            AgentRunCandidate(runId: "newest", agentId: "writer", startedAt: Date(timeIntervalSince1970: 112)),
        ]

        XCTAssertEqual(
            AgentRunReconciliation.matchedRunId(
                agentId: "writer",
                requestedAt: requestedAt,
                candidates: candidates
            ),
            "newest"
        )
    }
}
