import XCTest
@testable import AgentServerCore

final class ConsumerProductFlowTests: XCTestCase {
    func testEmptyCalendarQuestionExplainsHowToRestoreAccess() {
        let question = CreationQuestion(
            id: "calendar-id",
            prompt: "Which calendar may this agent use?",
            kind: .choice([]),
            isRequired: true
        )

        XCTAssertEqual(question.unavailableNativeResource, .calendar)
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

    func testCreationCanReturnFromProposalWithoutSavingStaleSettings() {
        var flow = AgentCreationFlow(request: "Create a weekly summary")
        flow.receiveProposal(.fixture(reviewId: "review-1"))

        flow.returnToRequest()

        XCTAssertEqual(flow.phase, .request)
        XCTAssertNil(flow.proposal)
        XCTAssertTrue(flow.answers.isEmpty)
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

        flow.didSave()
        XCTAssertEqual(flow.phase, .testing)
        XCTAssertTrue(flow.hasSaved)

        flow.completeTest()
        XCTAssertEqual(flow.phase, .complete)
    }

    func testSavedAgentResultKeepsTheSafeTestRunVisible() {
        let result = SavedAgentPresentation(agentId: "weekly-summary", safeTestRunId: "run-2")

        XCTAssertEqual(result.agentId, "weekly-summary")
        XCTAssertEqual(result.safeTestRunId, "run-2")
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

        flow.resolve()
        XCTAssertEqual(flow.phase, .resolved)
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
        XCTAssertEqual(ConsumerFlowAccessibility.creationReview, "creation.review")
        XCTAssertEqual(ConsumerFlowAccessibility.creationSimilar, "creation.similar")
        XCTAssertEqual(ConsumerFlowAccessibility.creationConnectionSetup, "creation.connectionSetup")
        XCTAssertEqual(ConsumerFlowAccessibility.debuggerApplyFix, "debugger.applyFix")
        XCTAssertEqual(ConsumerFlowAccessibility.securityScanAll, "security.scanAll")
        XCTAssertEqual(ConsumerFlowAccessibility.securityFindingPrefix, "security.finding.")
        XCTAssertEqual(ConsumerFlowAccessibility.securityNavigation, "security.navigation")
        XCTAssertEqual(ConsumerFlowAccessibility.debuggerOpen, "debugger.open")
    }

    func testSidebarFooterPresentsCreationThenFolderChoice() {
        XCTAssertEqual(
            SidebarFooterAction.allCases,
            [.newAgent, .chooseFolder]
        )
        XCTAssertEqual(SidebarFooterAction.newAgent.title, "New Agent")
        XCTAssertEqual(SidebarFooterAction.chooseFolder.title, "Choose a folder")
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
    static func fixture(risk: ConsumerRiskLevel = .low, reviewId: String? = nil) -> Self {
        .init(
            reviewId: reviewId,
            name: "Weekly summary",
            explanation: "Reviews activity and prepares a short summary.",
            schedule: "Every Friday at 5:00 p.m.",
            permissions: ["Read GitHub activity", "Send a Slack message"],
            fileAccess: [],
            connections: [.init(name: "Slack", state: .needsSetup)],
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
