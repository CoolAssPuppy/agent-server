import XCTest
@testable import AgentServerCore

final class ConsumerProductFlowTests: XCTestCase {
    func testCreationCanReturnToTheDescriptionFromALaterStep() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveQuestions([
            CreationQuestion(id: "tone", prompt: "Which tone?", kind: .text, isRequired: true),
        ])
        flow.answer(questionId: "tone", value: "Concise")

        XCTAssertTrue(flow.canGoBack)
        flow.goBack()

        XCTAssertEqual(flow.phase, .request)
        XCTAssertEqual(flow.request, "Send a weekly summary")
        XCTAssertEqual(flow.answers["tone"], .string("Concise"))
    }

    func testConnectionSetupCanBeDeferredWithoutLosingTheRequestedServices() {
        var flow = AgentCreationFlow(request: "Send a summary to Notion and Slack")
        flow.receiveQuestions([
            CreationQuestion(
                id: "connection-notion",
                prompt: "Which Notion connection?",
                kind: .service(name: "Notion", choices: ["Personal Notion"]),
                isRequired: true,
                choiceValues: ["notion-personal"]
            ),
            CreationQuestion(
                id: "connection-slack",
                prompt: "Which Slack connection?",
                kind: .service(name: "Slack", choices: []),
                isRequired: true
            ),
        ])

        flow.deferConnectionSetup()

        XCTAssertTrue(flow.areConnectionQuestionsAnswered)
        XCTAssertTrue(flow.canRequestProposal)
        XCTAssertEqual(flow.answers["connection-notion"], .string(CreationAnswerValue.setUpLater))
        XCTAssertEqual(flow.answers["connection-slack"], .string(CreationAnswerValue.setUpLater))
    }

    func testConnectionSetupGroupsEveryMentionedService() {
        var flow = AgentCreationFlow(request: "Save to Notion and create a Linear issue")
        flow.receiveQuestions([
            CreationQuestion(
                id: "connection-notion",
                prompt: "Which Notion connection?",
                kind: .service(name: "Notion", choices: ["Personal Notion"]),
                isRequired: true,
                choiceValues: ["notion-personal"]
            ),
            CreationQuestion(
                id: "connection-linear",
                prompt: "Which Linear connection?",
                kind: .service(name: "Linear", choices: ["Work Linear"]),
                isRequired: true,
                choiceValues: ["linear-work"]
            ),
        ])

        XCTAssertEqual(flow.pendingConnectionQuestions.map(\.id), ["connection-notion", "connection-linear"])
        flow.answer(questionId: "connection-notion", value: "notion-personal")
        XCTAssertEqual(flow.pendingConnectionQuestions.map(\.id), ["connection-linear"])
        flow.answer(questionId: "connection-linear", value: "linear-work")
        XCTAssertTrue(flow.pendingConnectionQuestions.isEmpty)
        XCTAssertTrue(flow.canRequestProposal)
    }

    func testConnectionRefreshPreservesValidSelectionsAndClearsRemovedAccounts() {
        let notion = CreationQuestion(
            id: "connection-notion",
            prompt: "Which Notion connection?",
            kind: .service(name: "Notion", choices: ["Personal Notion"]),
            isRequired: true,
            choiceValues: ["notion-personal"]
        )
        var flow = AgentCreationFlow(request: "Use Notion")
        flow.receiveQuestions([notion])
        flow.answer(questionId: notion.id, value: "notion-personal")

        flow.receiveQuestions([notion])
        XCTAssertEqual(flow.answers[notion.id], .string("notion-personal"))

        flow.receiveQuestions([
            CreationQuestion(
                id: notion.id,
                prompt: notion.prompt,
                kind: .service(name: "Notion", choices: ["Work Notion"]),
                isRequired: true,
                choiceValues: ["notion-work"]
            ),
        ])
        XCTAssertNil(flow.answers[notion.id])
    }

    func testCreationSetupCopyUsesConsumerLanguage() {
        XCTAssertEqual(CreationConnectionStepCopy.title, "Let's setup the connections you need for your agent")
        XCTAssertEqual(
            CreationConnectionStepCopy.explanation,
            "This helps your agent get and send data to the right place"
        )
        XCTAssertEqual(
            CreationFileAccessStepCopy.explanation,
            "You have to explicitly grant your agent access to your machine."
        )
    }

    func testUnsupportedServiceTelemetryIsNormalizedAndEmittedOnce() {
        let ids = UnsupportedCreationServiceClassifier.serviceIDs(
            in: "Copy an Airtable record to Jira, then update AIRTABLE."
        )
        var tracker = UnsupportedServiceTelemetryTracker()

        XCTAssertEqual(ids, ["airtable", "jira"])
        XCTAssertEqual(tracker.newServiceIDs(from: ids), ["airtable", "jira"])
        XCTAssertTrue(tracker.newServiceIDs(from: ids).isEmpty)
        XCTAssertTrue(
            UnsupportedCreationServiceClassifier.serviceIDs(in: "Write a book about a trellis").isEmpty
        )
    }

    func testFolderPickerAcceptsOnlyOneDirectory() {
        let picker = CreationResourcePickerMode.folder

        XCTAssertFalse(picker.allowsMultipleSelection)
        XCTAssertTrue(picker.accepts(isDirectory: true))
        XCTAssertFalse(picker.accepts(isDirectory: false))
    }

    func testFileAccessPickerAcceptsFilesAndFoldersInOneMultipleSelection() {
        let picker = CreationResourcePickerMode.filesAndFolders

        XCTAssertTrue(picker.allowsMultipleSelection)
        XCTAssertTrue(picker.accepts(isDirectory: false))
        XCTAssertTrue(picker.accepts(isDirectory: true))
    }

    func testEmptyCalendarQuestionExplainsHowToRestoreAccess() {
        let question = CreationQuestion(
            id: "calendar-id",
            prompt: "Which calendar may this agent use?",
            kind: .choice([]),
            isRequired: true
        )

        XCTAssertEqual(question.unavailableNativeResource, .calendar)
    }

    func testServiceQuestionExplainsWhyNotionIsBeingRequested() {
        let question = CreationQuestion(
            id: "connection-notion",
            prompt: "Which Notion connection should this agent use?",
            kind: .service(name: "Notion", choices: ["Personal Notion", "Work Notion"]),
            isRequired: true
        )

        XCTAssertEqual(question.serviceContextTitle, "You mentioned Notion")
        XCTAssertEqual(
            question.serviceContextExplanation,
            "Choose the Notion account this agent should use."
        )
    }

    func testEmptyReminderQuestionExplainsHowToRestoreAccess() {
        let question = CreationQuestion(
            id: "reminder-list-id",
            prompt: "Which reminder list may this agent use?",
            kind: .choice([]),
            isRequired: true
        )

        XCTAssertEqual(question.unavailableNativeResource, .reminders)
    }

    func testEmptyContactsQuestionExplainsHowToRestoreAccess() {
        let question = CreationQuestion(
            id: "contact-group-id",
            prompt: "Which contact group may this agent use?",
            kind: .choice([]),
            isRequired: true
        )

        XCTAssertEqual(question.unavailableNativeResource, .contacts)
    }

    func testReissuedNativeResourceQuestionClearsItsDependentPermission() {
        var flow = AgentCreationFlow(request: "Review my reminders")
        flow.receiveQuestions([
            CreationQuestion(id: "reminder-list-id", prompt: "Which list?", kind: .choice(["Personal"]), isRequired: true),
            CreationQuestion(id: "reminder-actions", prompt: "What may it do?", kind: .choice(["View and add"]), isRequired: true),
        ])
        flow.answer(questionId: "reminder-list-id", value: "old-list")
        flow.answer(questionId: "reminder-actions", value: "read_create")

        flow.receiveQuestions([
            CreationQuestion(id: "reminder-list-id", prompt: "Which list?", kind: .choice(["Work"]), isRequired: true),
        ])

        XCTAssertNil(flow.answers["reminder-list-id"])
        XCTAssertNil(flow.answers["reminder-actions"])
    }

    func testRefreshingUnavailableNativeResourcesPreservesOtherAnswers() {
        var flow = AgentCreationFlow(request: "Use Notion and my calendar")
        flow.receiveQuestions([
            CreationQuestion(id: "connection-notion", prompt: "Which Notion?", kind: .service(name: "Notion", choices: ["Personal"]), isRequired: true),
            CreationQuestion(id: "calendar-id", prompt: "Which calendar?", kind: .choice([]), isRequired: true),
        ])
        flow.answer(questionId: "connection-notion", value: "notion-personal")
        flow.receiveQuestions([
            CreationQuestion(id: "calendar-id", prompt: "Which calendar?", kind: .choice([]), isRequired: true),
        ])

        flow.beginQuestionRefresh()

        XCTAssertEqual(flow.phase, .preparingProposal)
        XCTAssertEqual(flow.answers["connection-notion"], .string("notion-personal"))
    }

    func testCreationAsksOnlyUnansweredRequiredQuestions() {
        let questions = [
            CreationQuestion(id: "folder", prompt: "Which folder should it review?", kind: .folder, isRequired: true),
            CreationQuestion(id: "tone", prompt: "What tone should it use?", kind: .choice(["Short", "Detailed"]), isRequired: false),
        ]
        var flow = AgentCreationFlow(request: "Summarize my research every Friday")

        flow.receiveQuestions(questions)
        XCTAssertEqual(flow.phase, .questions)
        XCTAssertEqual(flow.nextQuestion?.id, "folder")

        flow.answer(questionId: "folder", value: "~/Documents/Research")
        XCTAssertNil(flow.nextQuestion)
        XCTAssertTrue(flow.canRequestProposal)
    }

    func testChoosingNoFileAccessCountsAsAnExplicitAnswer() {
        let question = CreationQuestion(
            id: "file-access",
            prompt: "Which files or folders may this agent use?",
            kind: .fileAccess,
            isRequired: true
        )
        var flow = AgentCreationFlow(request: "Review my manuscript")
        flow.receiveQuestions([question])

        flow.answer(questionId: question.id, value: .fileGrants([]))

        XCTAssertNil(flow.nextQuestion)
        XCTAssertTrue(flow.canRequestProposal)
    }

    func testRetryableFailureUsesOneConciseVisibleMessage() {
        let failure = ConsumerFlowFailure(
            title: "Could not prepare your agent",
            message: "The local creation service did not finish the proposal.",
            recovery: "Your description and choices are still here.",
            technicalDetails: "The model response was invalid.",
            didSave: false,
            canRetry: true
        )

        XCTAssertEqual(
            failure.conciseMessage,
            "The local creation service did not finish the proposal. Nothing was saved."
        )
        XCTAssertNil(failure.visibleRecovery)
    }

    func testUncertainSaveFailureDoesNotClaimTheAgentWasOrWasNotSaved() {
        let failure = ConsumerFlowFailure(
            title: "Could not confirm the save",
            message: "Your agent may already be saved.",
            recovery: "Check the agent list, then try again safely.",
            technicalDetails: "The request timed out twice.",
            didSave: nil,
            canRetry: true
        )

        XCTAssertEqual(failure.conciseMessage, "Your agent may already be saved.")
        XCTAssertNil(failure.didSave)
    }

    func testFailureWithoutRetryKeepsItsRecoveryInstructionVisible() {
        let failure = ConsumerFlowFailure(
            title: "File access was denied",
            message: "The selected folder could not be opened.",
            recovery: "Choose another folder or allow access in System Settings.",
            technicalDetails: "NSFileReadNoPermissionError",
            didSave: false,
            canRetry: false
        )

        XCTAssertEqual(
            failure.visibleRecovery,
            "Choose another folder or allow access in System Settings."
        )
    }

    func testCreationKeepsProposalReviewableBeforeSaving() {
        let proposal = AgentProposalPresentation.fixture(risk: .needsReview, reviewId: "proposal-1")
        var flow = AgentCreationFlow(request: "Send a weekly summary")

        flow.receiveProposal(proposal)
        XCTAssertEqual(flow.phase, .proposal)
        XCTAssertEqual(flow.proposal, proposal)
        XCTAssertEqual(flow.proposal?.reviewId, "proposal-1")
        XCTAssertFalse(flow.hasSaved)

        flow.beginSave(runSafeTest: true)
        XCTAssertEqual(flow.phase, .saving)
        XCTAssertTrue(flow.shouldRunSafeTest)
    }

    func testRefreshingConnectionReadinessPreservesTheDraftAndAnswers() {
        let question = CreationQuestion(
            id: "destination",
            prompt: "Where should it send the summary?",
            kind: .choice(["Slack", "Save as a file"]),
            isRequired: true
        )
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveQuestions([question])
        flow.answer(questionId: question.id, value: "Slack")
        flow.receiveProposal(.fixture())

        flow.beginProposalRequest()

        XCTAssertEqual(flow.phase, .preparingProposal)
        XCTAssertEqual(flow.request, "Send a weekly summary")
        XCTAssertEqual(flow.answers[question.id], .string("Slack"))
        XCTAssertNotNil(flow.proposal)
    }

    func testReissuedQuestionClearsItsStaleAnswer() {
        let question = CreationQuestion(
            id: "connection-notion",
            prompt: "Which Notion connection should this agent use?",
            kind: .service(name: "Notion", choices: ["Personal Notion"]),
            isRequired: true,
            choiceValues: ["notion-personal"]
        )
        var flow = AgentCreationFlow(request: "Save a review in Personal Notion")
        flow.receiveQuestions([question])
        flow.answer(questionId: question.id, value: "removed-notion")

        flow.receiveQuestions([question])

        XCTAssertNil(flow.answers[question.id])
        XCTAssertEqual(flow.nextQuestion?.id, question.id)
        XCTAssertEqual(flow.phase, .questions)
    }

    func testEditingAProposalPreservesReviewedAnswersWhileDiscardingTheStaleProposal() {
        let question = CreationQuestion(
            id: "tone",
            prompt: "What tone should it use?",
            kind: .choice(["Short", "Detailed"]),
            isRequired: true
        )
        var flow = AgentCreationFlow(request: "Create a weekly summary")
        flow.receiveQuestions([question])
        flow.answer(questionId: question.id, value: "Short")
        flow.receiveProposal(.fixture(reviewId: "review-1"))

        flow.returnToRequest()

        XCTAssertEqual(flow.phase, .request)
        XCTAssertNil(flow.proposal)
        XCTAssertEqual(flow.answers[question.id], .string("Short"))
        XCTAssertEqual(flow.questions, [question])

        flow.reviseRequest("Create a shorter weekly summary")
        XCTAssertEqual(flow.request, "Create a shorter weekly summary")
        XCTAssertEqual(flow.answers[question.id], .string("Short"))
    }

    func testCreationKeepsMultipleFileGrantsWithIndependentAccess() {
        let question = CreationQuestion(
            id: "file-access",
            prompt: "Which files or folders may this agent use?",
            kind: .fileAccess,
            isRequired: true
        )
        let grants = [
            CreationFileGrant(path: "/Users/test/Book/manuscript.docx", kind: .file, access: .readOnly),
            CreationFileGrant(path: "/Users/test/Book/Notes", kind: .folder, access: .readWrite),
        ]
        var flow = AgentCreationFlow(request: "Review my manuscript")
        flow.receiveQuestions([question])

        flow.answer(questionId: question.id, value: .fileGrants(grants))

        XCTAssertEqual(flow.answers[question.id], .fileGrants(grants))
        XCTAssertNil(flow.nextQuestion)

        flow.receiveQuestions([question])
        XCTAssertEqual(flow.answers[question.id], .fileGrants(grants))
        XCTAssertNil(flow.nextQuestion)
        XCTAssertEqual(flow.phase, .questions)
    }

    func testCreationCompletesOnlyAfterTheRequestedSafeTestFinishes() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveProposal(.fixture())
        flow.beginSave(runSafeTest: true)

        flow.didSave(SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: "run-2"))
        XCTAssertEqual(flow.phase, .testing)
        XCTAssertTrue(flow.hasSaved)
        XCTAssertEqual(flow.safeTestRunId, "run-2")

        flow.updateSafeTest(.running)
        XCTAssertEqual(flow.phase, .testing)

        flow.updateSafeTest(.completed)
        XCTAssertEqual(flow.phase, .complete)
    }

    func testFailedSafeTestKeepsTheSavedAgentAndOffersDebuggerRouting() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveProposal(.fixture())
        flow.beginSave(runSafeTest: true)
        flow.didSave(SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: "run-2"))

        flow.updateSafeTest(.failed("Slack is not connected"))

        XCTAssertEqual(flow.phase, .failed)
        XCTAssertTrue(flow.hasSaved)
        XCTAssertEqual(flow.failedSafeTestRunId, "run-2")
        XCTAssertEqual(flow.failure?.title, "The safe test found a problem")
        XCTAssertTrue(flow.failure?.didSave == true)
    }

    func testStoppedSafeTestKeepsTheAgentWithoutClaimingTheTestPassed() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveProposal(.fixture())
        flow.beginSave(runSafeTest: true)
        flow.didSave(SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: "run-2"))

        flow.updateSafeTest(.stopped)

        XCTAssertEqual(flow.phase, .complete)
        XCTAssertEqual(flow.safeTestState, .stopped)
        XCTAssertNil(flow.failedSafeTestRunId)
    }

    func testMissingSafeTestRunIdentifierCannotLeaveCreationStuck() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveProposal(.fixture())
        flow.beginSave(runSafeTest: true)

        flow.didSave(SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: nil))

        XCTAssertEqual(flow.phase, .complete)
        XCTAssertTrue(flow.hasSaved)
    }

    func testSavedAgentResultKeepsTheSafeTestRunVisible() {
        let result = SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: "run-2")

        XCTAssertEqual(result.agentId, "weekly-summary")
        XCTAssertEqual(result.safeTestRunId, "run-2")
    }

    func testRequiredMissingConnectionsMustBeSetUpBeforeSaving() {
        let proposal = AgentProposalPresentation.fixture(connections: [
            .init(name: "Personal Notion", state: .needsSetup, isRequired: true),
            .init(name: "Slack", state: .optional, isRequired: false),
        ])

        XCTAssertFalse(proposal.readiness.canSave)
        XCTAssertEqual(proposal.readiness.requiredSetupNames, ["Personal Notion"])
        XCTAssertEqual(proposal.readiness.primaryActionTitle, "Set up Personal Notion")
    }

    func testOptionalMissingConnectionsDoNotBlockSaving() {
        let proposal = AgentProposalPresentation.fixture(connections: [
            .init(name: "Slack", state: .optional, isRequired: false),
        ])

        XCTAssertTrue(proposal.readiness.canSave)
        XCTAssertEqual(proposal.readiness.requiredSetupNames, [])
    }

    func testProposalSummaryLeadsWithIdentityScheduleSetupAndRisk() {
        let proposal = AgentProposalPresentation.fixture(
            connections: [.init(name: "Personal Notion", state: .needsSetup, isRequired: true)]
        )

        XCTAssertEqual(proposal.summary.name, "Weekly summary")
        XCTAssertEqual(proposal.summary.outcome, "Reviews activity and prepares a short summary.")
        XCTAssertEqual(proposal.summary.schedule, "Every Friday at 5:00 p.m.")
        XCTAssertEqual(proposal.summary.requiredSetupNames, ["Personal Notion"])
        XCTAssertEqual(proposal.summary.risk, .low)
    }

    func testProposalReviewUsesOneFlatHierarchyAndThreeConsumerTextRoles() {
        let proposal = AgentProposalPresentation(
            reviewId: "proposal-1",
            name: "Morning briefing",
            explanation: "Prepares a short briefing.",
            schedule: "Every weekday at 8:00 a.m.",
            permissions: ["Read selected files"],
            fileAccess: [.init(path: "/Users/example/Briefing", canEdit: false)],
            calendarAccess: [.init(id: "work", name: "Work", canEdit: false)],
            reminderAccess: [.init(id: "tasks", name: "Tasks", actions: ["View reminders"])],
            contactAccess: [.init(id: "team", name: "Team", details: ["Names and email addresses"])],
            connections: [.init(name: "Notion", state: .connected)],
            instructions: "Prepare the briefing.",
            risk: .needsReview,
            riskReason: "This agent reads calendar events."
        )

        XCTAssertEqual(proposal.reviewPolicy.surfaceStyle, .flatSections)
        XCTAssertFalse(proposal.reviewPolicy.usesNestedCards)
        XCTAssertEqual(proposal.reviewPolicy.consumerTextRoles, [.sectionTitle, .body, .secondary])
        XCTAssertEqual(
            proposal.reviewSections,
            [.summary, .connections, .files, .calendars, .reminders, .contacts, .permissions, .instructions]
        )
    }

    func testProposalReviewOmitsEmptyAccessSectionsWithoutHidingPermissionsOrInstructions() {
        let proposal = AgentProposalPresentation.fixture(connections: [])

        XCTAssertEqual(proposal.reviewSections, [.summary, .permissions, .instructions])
    }

    func testCreationFailureExplainsWhetherAnythingWasSavedAndCanRetry() {
        var flow = AgentCreationFlow(request: "Send a weekly summary")
        flow.receiveProposal(.fixture())
        flow.beginSave(runSafeTest: false)
        flow.fail(.init(
            title: "Could not save this agent",
            message: "The local server is offline.",
            recovery: "Start the server, then try again.",
            technicalDetails: "ECONNREFUSED",
            didSave: false,
            canRetry: true
        ))

        XCTAssertEqual(flow.phase, .failed)
        XCTAssertFalse(flow.failure?.didSave ?? true)
        XCTAssertTrue(flow.canRetry)

        flow.retry()
        XCTAssertEqual(flow.phase, .proposal)
    }

    func testDebuggerRequiresFixReviewBeforeApplying() {
        let diagnosis = DiagnosticPresentation.fixture()
        var flow = AgentDebuggerFlow()

        flow.receiveDiagnosis(diagnosis)
        XCTAssertEqual(flow.phase, .diagnosis)
        XCTAssertFalse(flow.canApplyFix)

        flow.reviewRecommendedFix()
        XCTAssertEqual(flow.phase, .fixReview)
        XCTAssertTrue(flow.canApplyFix)

        flow.beginApply()
        XCTAssertEqual(flow.phase, .applying)
    }

    func testDebuggerUsesAFlatReadingFlowWithTechnicalContentDisclosed() {
        XCTAssertEqual(AgentDebuggerPresentation.surfaceStyle, .flatSections)
        XCTAssertTrue(AgentDebuggerPresentation.disclosesTechnicalDetails)
        XCTAssertEqual(
            AgentDebuggerPresentation.unavailableState,
            .init(
                title: "This run cannot be diagnosed",
                message: "The run is still available in history. You can review the agent's settings now.",
                actionTitle: "Open agent settings"
            )
        )
    }

    func testDebuggerPreservesFailedRunWhileRetrying() {
        var flow = AgentDebuggerFlow(failedRunId: "failed-1")
        flow.receiveDiagnosis(.fixture())
        flow.reviewRecommendedFix()
        flow.beginApply()
        flow.didApplyFix()
        flow.beginRetry()
        flow.didStartRetry(runId: "retry-2")

        XCTAssertEqual(flow.phase, .retrying)
        XCTAssertEqual(flow.failedRunId, "failed-1")
        XCTAssertEqual(flow.retryRunId, "retry-2")

        flow.updateRetry(runId: "retry-2", state: .completed)
        XCTAssertEqual(flow.phase, .resolved)
    }

    func testDebuggerIgnoresUnrelatedRunUpdatesAndExplainsRetryFailure() {
        var flow = AgentDebuggerFlow(failedRunId: "failed-1")
        flow.receiveDiagnosis(.fixture())
        flow.beginRetry()
        flow.didStartRetry(runId: "retry-2")

        flow.updateRetry(runId: "other-run", state: .completed)
        XCTAssertEqual(flow.phase, .retrying)

        flow.updateRetry(runId: "retry-2", state: .failed("Still missing access"))
        XCTAssertEqual(flow.phase, .failed)
        XCTAssertEqual(flow.failure?.title, "The retry still needs attention")
        XCTAssertEqual(flow.retryRunId, "retry-2")
    }

    func testDebuggerDoesNotOfferUnvalidatedModelRecommendationAsApplicable() {
        let fix = ConfigurationFixPresentation(
            title: "Review file access",
            impact: "A person needs to choose the correct folder.",
            risk: .needsReview,
            changes: ["Choose a folder"],
            technicalDiff: "",
            canApply: false
        )
        var flow = AgentDebuggerFlow()
        flow.receiveDiagnosis(DiagnosticPresentation(
            title: "The folder may have moved.",
            explanation: "No current path was found.",
            evidence: [],
            recommendedFix: fix,
            preventionTip: nil,
            technicalDetails: ""
        ))

        flow.reviewRecommendedFix()

        XCTAssertEqual(flow.phase, .diagnosis)
        XCTAssertFalse(flow.canApplyFix)
    }

    func testDebuggerRerunSafetyDefaultsToConfirmationAndCanExplicitlyBlockRetry() {
        let defaultDiagnosis = DiagnosticPresentation(
            title: "The run failed.",
            explanation: "The cause needs review.",
            evidence: [],
            recommendedFix: nil,
            preventionTip: nil,
            technicalDetails: ""
        )
        let unsafeDiagnosis = DiagnosticPresentation(
            title: "The run may delete files.",
            explanation: "Trying again without changes could repeat a destructive action.",
            evidence: [],
            recommendedFix: nil,
            preventionTip: nil,
            technicalDetails: "",
            rerunSafety: .unsafe
        )

        XCTAssertEqual(defaultDiagnosis.rerunSafety, .confirm)
        XCTAssertEqual(unsafeDiagnosis.rerunSafety, .unsafe)
    }

    func testDebuggerShowsEvidenceOnlyWhenThereAreFactsToReview() {
        let withoutEvidence = DiagnosticPresentation(
            title: "The run failed.",
            explanation: "No local evidence was available.",
            evidence: [],
            recommendedFix: nil,
            preventionTip: nil,
            technicalDetails: ""
        )
        let withEvidence = DiagnosticPresentation(
            title: "The run failed.",
            explanation: "The destination could not be reached.",
            evidence: ["Notion was not connected"],
            recommendedFix: nil,
            preventionTip: nil,
            technicalDetails: ""
        )

        XCTAssertFalse(withoutEvidence.hasEvidence)
        XCTAssertTrue(withEvidence.hasEvidence)
    }

    func testSecuritySummaryGroupsFindingsByImportanceAndUsesNonColorLabels() {
        let findings = [
            SecurityFindingPresentation.fixture(id: "medium", severity: .needsReview),
            SecurityFindingPresentation.fixture(id: "critical", severity: .critical),
            SecurityFindingPresentation.fixture(id: "high", severity: .high),
        ]
        let summary = SecurityScanPresentation(findings: findings, reviewedAt: nil, isStale: true)

        XCTAssertEqual(summary.overallRisk, .critical)
        XCTAssertEqual(summary.groupedFindings.map(\.severity), [.critical, .high, .needsReview])
        XCTAssertEqual(summary.groupedFindings.first?.title, "Critical")
        XCTAssertEqual(summary.summaryText, "Security check found 3 things to review.")
    }

    func testSecurityDashboardCountsAgentsByRiskAndReviewState() {
        let dashboard = SecurityDashboardPresentation(agents: [
            .fixture(id: "one", risk: .low, isStale: false),
            .fixture(id: "two", risk: .high, isStale: true),
            .fixture(id: "three", risk: .critical, isStale: false),
        ])

        XCTAssertEqual(dashboard.agentCount(for: .low), 1)
        XCTAssertEqual(dashboard.agentCount(for: .high), 1)
        XCTAssertEqual(dashboard.agentCount(for: .critical), 1)
        XCTAssertEqual(dashboard.needsReviewCount, 1)
    }

    func testCriticalControlsHaveStableAccessibilityIdentifiers() {
        XCTAssertEqual(ConsumerFlowAccessibility.sidebarCreateAgent, "sidebar.createAgent")
        XCTAssertEqual(ConsumerFlowAccessibility.creationRequest, "creation.request")
        XCTAssertEqual(ConsumerFlowAccessibility.creationBack, "creation.back")
        XCTAssertEqual(ConsumerFlowAccessibility.creationSetUpLater, "creation.setUpLater")
        XCTAssertEqual(ConsumerFlowAccessibility.creationReview, "creation.review")
        XCTAssertEqual(ConsumerFlowAccessibility.creationSimilar, "creation.similar")
        XCTAssertEqual(ConsumerFlowAccessibility.creationConnectionSetup, "creation.connectionSetup")
        XCTAssertEqual(ConsumerFlowAccessibility.debuggerApplyFix, "debugger.applyFix")
        XCTAssertEqual(ConsumerFlowAccessibility.securityScanAll, "security.scanAll")
        XCTAssertEqual(ConsumerFlowAccessibility.securityFindingPrefix, "security.finding.")
        XCTAssertEqual(ConsumerFlowAccessibility.securityNavigation, "security.navigation")
        XCTAssertEqual(ConsumerFlowAccessibility.debuggerOpen, "debugger.open")
        XCTAssertEqual(ConsumerFlowAccessibility.failureRetry, "consumerFailure.retry")
        XCTAssertEqual(ConsumerFlowAccessibility.failureDetails, "consumerFailure.details")
    }

    func testSidebarFooterKeepsStorageOutOfPrimaryNavigation() {
        XCTAssertEqual(SidebarFooterAction.allCases, [.newAgent])
        XCTAssertEqual(SidebarFooterAction.newAgent.title, "New Agent")
        XCTAssertEqual(SidebarFooterAction.newAgent.systemImage, "plus")
    }

    func testScheduledSidebarKindDoesNotNeedASecondScheduleGlyph() {
        XCTAssertTrue(SidebarRow.Kind.scheduled.usesScheduleStatusIcon)
        XCTAssertFalse(SidebarRow.Kind.onDemand.usesScheduleStatusIcon)
    }

    func testDemoFixturesAreDeterministicAndContainNoCredentials() {
        XCTAssertEqual(ConsumerFlowDemoFixtures.proposal.name, "Friday GitHub summary")
        XCTAssertEqual(ConsumerFlowDemoFixtures.dashboard.agents.count, 3)

        let visibleText = [
            ConsumerFlowDemoFixtures.proposal.instructions,
            ConsumerFlowDemoFixtures.diagnosis.technicalDetails,
            ConsumerFlowDemoFixtures.securityScan.findings.map(\.trigger).joined(),
        ].joined()
        XCTAssertFalse(visibleText.localizedCaseInsensitiveContains("token="))
        XCTAssertFalse(visibleText.localizedCaseInsensitiveContains("api_key"))
    }
}

private extension AgentProposalPresentation {
    static func fixture(
        risk: ConsumerRiskLevel = .low,
        reviewId: String? = nil,
        connections: [ConnectionPresentation] = [.init(name: "Slack", state: .needsSetup)]
    ) -> Self {
        .init(
            reviewId: reviewId,
            name: "Weekly summary",
            explanation: "Reviews activity and prepares a short summary.",
            schedule: "Every Friday at 5:00 p.m.",
            permissions: ["Read GitHub activity", "Send a Slack message"],
            fileAccess: [],
            connections: connections,
            instructions: "Review this week's activity and summarize it.",
            risk: risk,
            riskReason: "This agent sends information to Slack."
        )
    }
}

private extension DiagnosticPresentation {
    static func fixture() -> Self {
        .init(
            title: "This agent could not save its report.",
            explanation: "It can read the Reports folder, but cannot make changes there.",
            evidence: ["The run tried to create weekly.md", "File editing is turned off"],
            recommendedFix: .init(
                title: "Allow edits in Documents/Reports",
                impact: "This agent could create and update files only in this folder.",
                risk: .needsReview,
                changes: ["Turn on file editing for Documents/Reports"],
                technicalDiff: "+ Write(~/Documents/Reports/**)"
            ),
            preventionTip: "Test the agent before turning on its schedule.",
            technicalDetails: "Write denied"
        )
    }
}

private extension SecurityFindingPresentation {
    static func fixture(id: String, severity: ConsumerRiskLevel) -> Self {
        .init(
            id: id,
            severity: severity,
            title: "Review file access",
            whyItMatters: "The agent can access more files than it needs.",
            potentialImpact: "A mistake could affect unrelated files.",
            trigger: "Broad file access",
            recommendation: "Choose a narrower folder.",
            functionalityImpact: "The agent will only work in the selected folder.",
            canFix: true
        )
    }
}

private extension SecurityAgentPresentation {
    static func fixture(id: String, risk: ConsumerRiskLevel, isStale: Bool) -> Self {
        .init(id: id, name: id.capitalized, risk: risk, findingCount: risk == .low ? 0 : 1, isStale: isStale)
    }
}
