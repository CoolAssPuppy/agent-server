import XCTest
@testable import AgentServerCore

final class DecisionMenuBarTests: XCTestCase {

    // MARK: - Popover accessibility presentation

    func testRunningAgentRowAnnouncesItsLiveStateWithoutRepeatingDescription() {
        XCTAssertEqual(
            MenuBarPopoverPresentation.agentAccessibilityLabel(
                name: "Weekly Goals Report",
                isRunning: true,
                schedule: "Monday at 7:00 AM"
            ),
            "Weekly Goals Report, running"
        )
    }

    func testAvailableAgentRowAnnouncesItsSchedule() {
        XCTAssertEqual(
            MenuBarPopoverPresentation.agentAccessibilityLabel(
                name: "Daily Portuguese and French",
                isRunning: false,
                schedule: "Daily at 5:00 AM"
            ),
            "Daily Portuguese and French, Daily at 5:00 AM"
        )
    }

    func testAvailableAgentWithoutScheduleHasAConciseLabel() {
        XCTAssertEqual(
            MenuBarPopoverPresentation.agentAccessibilityLabel(
                name: "Research assistant",
                isRunning: false,
                schedule: nil
            ),
            "Research assistant"
        )
    }

    func testPopoverControlCopyDescribesNavigationAndAppearance() {
        XCTAssertEqual(MenuBarPopoverPresentation.agentAccessibilityHint, "Opens agent details")
        XCTAssertEqual(MenuBarPopoverPresentation.appearanceTitle, "Appearance")
        XCTAssertEqual(MenuBarPopoverPresentation.appearanceHint, "Choose the app appearance")
    }

    // MARK: - Factory helpers (immutable, no beforeEach mutation)

    private func makeApprove(
        id: String = "dec_1",
        agentSlug: String = "finance-agent",
        agentName: String? = "Finance Agent",
        title: String = "Ship Acme Corp invoice for $12,400?",
        recommendation: String? = "approve"
    ) -> Decision {
        Decision(
            id: id,
            taskRunId: "run_1",
            agentSlug: agentSlug,
            agentName: agentName,
            type: .approve,
            title: title,
            payload: DecisionPayload(
                approveLabel: "Approve",
                declineLabel: "Decline",
                recommendation: recommendation,
                options: nil,
                allowNone: nil,
                recommendedOptionId: nil,
                prompt: nil,
                placeholder: nil,
                suggestedAnswer: nil,
                maxLength: nil,
                body: "Found an unused credit.",
                reasoning: "Credit expires soon.",
                confidence: 0.94,
                sources: [
                    DecisionSource(title: "United email", url: "https://mail.google.com/x", kind: "email"),
                ]
            ),
            status: .pending,
            dueAt: nil,
            deferUntil: nil,
            createdAt: Date().addingTimeInterval(-720),
            resolvedAt: nil,
            resolvedBy: nil,
            resolvedVia: nil,
            resolution: nil
        )
    }

    private func makePick(id: String = "dec_2", recommended: String? = "send_with_sponsor") -> Decision {
        Decision(
            id: id,
            taskRunId: "run_1",
            agentSlug: "proactive-agent",
            agentName: "Proactive Agent",
            type: .pick,
            title: "Stripe Sessions dinner: register Ankur?",
            payload: DecisionPayload(
                approveLabel: nil, declineLabel: nil, recommendation: nil,
                options: [
                    DecisionPickOption(id: "send_with_sponsor", label: "Send + offer sponsorship", description: "Builds goodwill"),
                    DecisionPickOption(id: "send_plain", label: "Send reply", description: "Just say yes"),
                    DecisionPickOption(id: "decline", label: "Decline", description: "Can't help"),
                ],
                allowNone: false,
                recommendedOptionId: recommended,
                prompt: nil, placeholder: nil, suggestedAnswer: nil, maxLength: nil,
                body: nil, reasoning: nil, confidence: 0.84, sources: nil
            ),
            status: .pending,
            dueAt: nil, deferUntil: nil,
            createdAt: Date(),
            resolvedAt: nil, resolvedBy: nil, resolvedVia: nil, resolution: nil
        )
    }

    // MARK: - "Needs you" section visibility

    func testNeedsYouSectionHiddenWhenNoPending() {
        let vm = MenuBarDecisionsViewModel(decisions: [])
        XCTAssertFalse(vm.isVisible, "Section should be hidden when there are no pending decisions")
        XCTAssertEqual(vm.cards.count, 0)
    }

    func testNeedsYouSectionShownWithOnePendingDecision() {
        let vm = MenuBarDecisionsViewModel(decisions: [makeApprove()])
        XCTAssertTrue(vm.isVisible)
        XCTAssertEqual(vm.cards.count, 1)
        XCTAssertEqual(vm.badgeCount, 1)
    }

    // MARK: - Card content

    func testApproveCardRendersTitleAgentNameAndTimestamp() {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove()]).cards[0]
        XCTAssertEqual(card.title, "Ship Acme Corp invoice for $12,400?")
        XCTAssertEqual(card.agentName, "Finance Agent")
        XCTAssertFalse(card.relativeTimestamp.isEmpty, "Card must show a relative timestamp")
    }

    func testApproveCardHasTwoAgentActionsWithRecommendedAccent() {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove()]).cards[0]
        XCTAssertEqual(card.agentActions.count, 2)
        XCTAssertEqual(card.agentActions[0].label, "Decline")
        XCTAssertEqual(card.agentActions[1].label, "Approve")
        XCTAssertTrue(card.agentActions[1].isRecommended, "Approve button should be accented when recommendation = 'approve'")
        XCTAssertFalse(card.agentActions[0].isRecommended)
    }

    func testApproveCardWithoutRecommendationHasNoAccent() {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove(recommendation: nil)]).cards[0]
        XCTAssertFalse(card.agentActions[0].isRecommended)
        XCTAssertFalse(card.agentActions[1].isRecommended)
    }

    func testPickCardHasOneButtonPerOptionPlusRecommendedAccent() {
        let card = MenuBarDecisionsViewModel(decisions: [makePick()]).cards[0]
        XCTAssertEqual(card.agentActions.count, 3)
        XCTAssertEqual(card.agentActions[0].label, "Send + offer sponsorship")
        XCTAssertTrue(card.agentActions[0].isRecommended)
        XCTAssertFalse(card.agentActions[1].isRecommended)
    }

    func testSystemRowIncludesDeferAndOpenInPanel() {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove()]).cards[0]
        let labels = card.systemActions.map(\.label)
        XCTAssertTrue(labels.contains(where: { $0.lowercased().contains("defer") }), "Defer action missing; got \(labels)")
        XCTAssertTrue(labels.contains(where: { $0.lowercased().contains("open in panel") }), "Open in Panel missing; got \(labels)")
    }

    // MARK: - Optimistic resolution

    func testResolveRemovesCardImmediately() {
        let vm = MenuBarDecisionsViewModel(decisions: [makeApprove(id: "a"), makePick(id: "b")])
        XCTAssertEqual(vm.cards.count, 2)
        vm.optimisticallyResolve(decisionId: "a")
        XCTAssertEqual(vm.cards.count, 1)
        XCTAssertEqual(vm.cards.first?.decisionId, "b")
    }

    // MARK: - Resolve body builders

    func testApproveActionBuildsApprovePayload() throws {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove()]).cards[0]
        let approveAction = card.agentActions[1]
        let body = approveAction.resolveBody
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["type"] as? String, "approve")
        XCTAssertEqual(json["approved"] as? Bool, true)
    }

    func testDeclineActionBuildsDeclinePayload() throws {
        let card = MenuBarDecisionsViewModel(decisions: [makeApprove()]).cards[0]
        let declineAction = card.agentActions[0]
        let data = try JSONEncoder().encode(declineAction.resolveBody)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["type"] as? String, "approve")
        XCTAssertEqual(json["approved"] as? Bool, false)
    }

    func testPickOptionBuildsPickPayload() throws {
        let card = MenuBarDecisionsViewModel(decisions: [makePick()]).cards[0]
        let option = card.agentActions[0]
        let data = try JSONEncoder().encode(option.resolveBody)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["type"] as? String, "pick")
        XCTAssertEqual(json["option_id"] as? String, "send_with_sponsor")
    }
}
