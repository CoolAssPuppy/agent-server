import Foundation

/// A stable Today and Activity contract used while demo mode is active.
enum DemoTodayActivitySnapshot {
    static func make(referenceDate: Date) -> TodayActivitySnapshot {
        TodayActivitySnapshot(
            today: ContractTodayPresentation(
                sections: makeTodaySections(referenceDate: referenceDate),
                allClear: nil
            ),
            activity: ContractActivityPresentation(
                items: makeActivityItems(referenceDate: referenceDate)
            )
        )
    }

    private static func makeTodaySections(referenceDate: Date) -> [ContractTodaySection] {
        [
            ContractTodaySection(
                kind: .needsYou,
                items: [makeNeedsYouItem(referenceDate: referenceDate)]
            ),
            ContractTodaySection(
                kind: .working,
                items: [makeWorkingItem(referenceDate: referenceDate)]
            ),
            ContractTodaySection(
                kind: .finished,
                items: [makeFinishedItem(referenceDate: referenceDate)]
            ),
            ContractTodaySection(
                kind: .problems,
                items: [makeProblemItem(referenceDate: referenceDate)]
            ),
            ContractTodaySection(
                kind: .upcoming,
                items: [makeUpcomingItem(referenceDate: referenceDate)]
            ),
        ]
    }

    private static func makeActivityItems(referenceDate: Date) -> [ContractActivityItem] {
        [
            makeActivityItem(
                runID: "demo-run-inbox",
                assistant: inboxAssistant,
                state: .needsYou,
                headline: "Inbox follow-up is ready to review",
                outcomeSummary: "Four messages may need a reply.",
                startedAt: referenceDate.addingTimeInterval(-5 * 60),
                endedAt: referenceDate.addingTimeInterval(-2 * 60),
                primaryOutput: "Review the private follow-up list"
            ),
            makeActivityItem(
                runID: "demo-run-briefing-current",
                assistant: briefingAssistant,
                state: .working,
                headline: "Morning briefing is working",
                outcomeSummary: nil,
                startedAt: referenceDate.addingTimeInterval(-10 * 60),
                endedAt: nil,
                primaryOutput: nil
            ),
            makeActivityItem(
                runID: "demo-run-language",
                assistant: languageAssistant,
                state: .finished,
                headline: "Daily language practice finished",
                outcomeSummary: "A 10-minute practice session is ready.",
                startedAt: referenceDate.addingTimeInterval(-90 * 60),
                endedAt: referenceDate.addingTimeInterval(-86 * 60),
                primaryOutput: "Portuguese and French practice"
            ),
            makeActivityItem(
                runID: "demo-run-inbox-failed",
                assistant: inboxAssistant,
                state: .problem,
                headline: "Inbox follow-up needs attention",
                outcomeSummary: "Gmail needs to be connected again.",
                startedAt: referenceDate.addingTimeInterval(-3 * 3_600),
                endedAt: referenceDate.addingTimeInterval(-179 * 60),
                primaryOutput: nil
            ),
        ]
    }

    private static func makeNeedsYouItem(referenceDate: Date) -> ContractTodayItem {
        makeTodayItem(
            id: "run:demo-run-inbox",
            section: .needsYou,
            assistant: inboxAssistant,
            headline: "Inbox follow-up is ready to review",
            explanation: "Review four messages that may need a reply.",
            occurredAt: referenceDate.addingTimeInterval(-5 * 60),
            expiresAt: referenceDate.addingTimeInterval(55 * 60),
            action: PresentationAction(
                kind: .respond,
                label: "Choose",
                targetReference: "interaction:demo-interaction-inbox"
            )
        )
    }

    private static func makeWorkingItem(referenceDate: Date) -> ContractTodayItem {
        makeTodayItem(
            id: "run:demo-run-briefing-current",
            section: .working,
            assistant: briefingAssistant,
            headline: "Morning briefing is working",
            explanation: "It is checking today's calendar and weather.",
            occurredAt: referenceDate.addingTimeInterval(-10 * 60),
            action: viewActivityAction(runID: "demo-run-briefing-current")
        )
    }

    private static func makeFinishedItem(referenceDate: Date) -> ContractTodayItem {
        makeTodayItem(
            id: "run:demo-run-language",
            section: .finished,
            assistant: languageAssistant,
            headline: "Daily language practice finished",
            explanation: "A 10-minute Portuguese and French practice session is ready.",
            occurredAt: referenceDate.addingTimeInterval(-90 * 60),
            action: viewActivityAction(runID: "demo-run-language")
        )
    }

    private static func makeProblemItem(referenceDate: Date) -> ContractTodayItem {
        makeTodayItem(
            id: "run:demo-run-inbox-failed",
            section: .problems,
            assistant: inboxAssistant,
            headline: "Inbox follow-up needs attention",
            explanation: "Gmail needs to be connected again.",
            occurredAt: referenceDate.addingTimeInterval(-3 * 3_600),
            action: PresentationAction(
                kind: .viewAssistant,
                label: "Reconnect",
                targetReference: "assistant:demo-inbox-follow-up"
            )
        )
    }

    private static func makeUpcomingItem(referenceDate: Date) -> ContractTodayItem {
        makeTodayItem(
            id: "schedule:demo-github-summary",
            section: .upcoming,
            assistant: githubAssistant,
            headline: "Friday GitHub summary runs next",
            explanation: "It will prepare the weekly team summary.",
            scheduledAt: referenceDate.addingTimeInterval(2 * 3_600),
            action: PresentationAction(
                kind: .viewAssistant,
                label: "View assistant",
                targetReference: "assistant:demo-github-summary"
            )
        )
    }

    private static func makeTodayItem(
        id: String,
        section: ContractTodaySectionKind,
        assistant: AssistantPresentationIdentity,
        headline: String,
        explanation: String,
        occurredAt: Date? = nil,
        scheduledAt: Date? = nil,
        expiresAt: Date? = nil,
        action: PresentationAction
    ) -> ContractTodayItem {
        ContractTodayItem(
            id: id,
            section: section,
            assistant: assistant,
            headline: statement(headline),
            explanation: statement(explanation),
            occurredAt: occurredAt,
            scheduledAt: scheduledAt,
            expiresAt: expiresAt,
            primaryAction: action,
            secondaryDisclosure: nil,
            sourceReferences: ["demo.fixture"]
        )
    }

    private static func makeActivityItem(
        runID: String,
        assistant: AssistantPresentationIdentity,
        state: ContractActivityState,
        headline: String,
        outcomeSummary: String?,
        startedAt: Date,
        endedAt: Date?,
        primaryOutput: String?
    ) -> ContractActivityItem {
        ContractActivityItem(
            id: "run:\(runID)",
            assistant: assistant,
            conversationId: nil,
            state: state,
            headline: statement(headline),
            outcomeSummary: outcomeSummary.map(statement),
            startedAt: startedAt,
            endedAt: endedAt,
            primaryOutput: primaryOutput.map(statement),
            reviewReference: "/runs/\(runID)/review",
            sourceReferences: ["demo.fixture"]
        )
    }

    private static func viewActivityAction(runID: String) -> PresentationAction {
        PresentationAction(
            kind: .viewActivity,
            label: "View activity",
            targetReference: "run:\(runID)"
        )
    }

    private static func statement(_ text: String) -> PresentationStatement {
        PresentationStatement(text: text, evidenceReferences: ["demo.fixture"])
    }

    private static func assistant(
        id: String,
        name: String
    ) -> AssistantPresentationIdentity {
        AssistantPresentationIdentity(
            installationId: "demo-machine:\(id)",
            machineId: "demo-machine",
            localAgentId: id,
            displayName: name
        )
    }

    private static let briefingAssistant = assistant(id: "demo-morning-briefing", name: "Morning briefing")
    private static let inboxAssistant = assistant(id: "demo-inbox-follow-up", name: "Inbox follow-up")
    private static let languageAssistant = assistant(id: "demo-language-practice", name: "Daily language practice")
    private static let githubAssistant = assistant(id: "demo-github-summary", name: "Friday GitHub summary")
}

private extension ContractTodayItem {
    init(
        id: String,
        section: ContractTodaySectionKind,
        assistant: AssistantPresentationIdentity,
        headline: PresentationStatement,
        explanation: PresentationStatement,
        occurredAt: Date?,
        scheduledAt: Date?,
        expiresAt: Date?,
        primaryAction: PresentationAction,
        secondaryDisclosure: PresentationAction?,
        sourceReferences: [String]
    ) {
        self.id = id
        self.section = section
        self.assistant = assistant
        self.headline = headline
        self.explanation = explanation
        self.occurredAt = occurredAt
        self.scheduledAt = scheduledAt
        self.expiresAt = expiresAt
        self.primaryAction = primaryAction
        self.secondaryDisclosure = secondaryDisclosure
        self.sourceReferences = sourceReferences
    }
}

private extension ContractActivityItem {
    init(
        id: String,
        assistant: AssistantPresentationIdentity,
        conversationId: String?,
        state: ContractActivityState,
        headline: PresentationStatement,
        outcomeSummary: PresentationStatement?,
        startedAt: Date,
        endedAt: Date?,
        primaryOutput: PresentationStatement?,
        reviewReference: String,
        sourceReferences: [String]
    ) {
        self.id = id
        self.assistant = assistant
        self.conversationId = conversationId
        self.state = state
        self.headline = headline
        self.outcomeSummary = outcomeSummary
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.primaryOutput = primaryOutput
        self.reviewReference = reviewReference
        self.sourceReferences = sourceReferences
    }
}
