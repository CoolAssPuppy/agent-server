import Foundation

// MARK: - Card models rendered by MenuBarPopover

struct DecisionActionIntent: Hashable {
    let kind: Kind
    let label: String
    let isRecommended: Bool
    let resolveBody: DecisionResolveBody
    let accessibilityLabel: String

    enum Kind: Hashable {
        case approve
        case decline
        case pick(optionId: String)
        case answerSubmit
        case defer1Hour
        case deferTomorrow
        case openInPanel
        case cancel
    }
}

struct DecisionCard: Identifiable, Hashable {
    let decisionId: String
    let title: String
    let agentName: String
    let body: String?
    let reasoning: String?
    let confidence: Double?
    let sourcesCount: Int
    let relativeTimestamp: String
    let agentActions: [DecisionActionIntent]
    let systemActions: [DecisionActionIntent]
    let openInPanelURL: String?

    var id: String { decisionId }
}

// MARK: - View model

/// Pure, testable state container that drives the "Needs you" section of
/// `MenuBarPopover`. Knows nothing about SwiftUI; publishing is handled by
/// `StatusMonitor`, which owns the input array.
final class MenuBarDecisionsViewModel {
    private(set) var cards: [DecisionCard]

    init(decisions: [Decision]) {
        self.cards = decisions
            .filter { $0.isPending }
            .map(DecisionCard.make(from:))
    }

    var isVisible: Bool { !cards.isEmpty }

    var badgeCount: Int { cards.count }

    func optimisticallyResolve(decisionId: String) {
        cards.removeAll { $0.decisionId == decisionId }
    }
}

// MARK: - Card construction

extension DecisionCard {
    static func make(from decision: Decision) -> DecisionCard {
        let agentActions: [DecisionActionIntent]
        switch decision.type {
        case .approve:
            agentActions = approveActions(for: decision)
        case .pick:
            agentActions = pickActions(for: decision)
        case .answer:
            agentActions = answerActions(for: decision)
        }

        let systemActions: [DecisionActionIntent] = [
            DecisionActionIntent(
                kind: .defer1Hour,
                label: "Defer 1h",
                isRecommended: false,
                resolveBody: .defer_(until: Date().addingTimeInterval(3600)),
                accessibilityLabel: "Defer decision for one hour"
            ),
            DecisionActionIntent(
                kind: .deferTomorrow,
                label: "Defer until tomorrow",
                isRecommended: false,
                resolveBody: .defer_(until: nextMorning()),
                accessibilityLabel: "Defer decision until tomorrow morning"
            ),
            DecisionActionIntent(
                kind: .openInPanel,
                label: "Open in Panel",
                isRecommended: false,
                resolveBody: .defer_(until: Date()),
                accessibilityLabel: "Open this decision in the Panel web app"
            ),
        ]

        return DecisionCard(
            decisionId: decision.id,
            title: decision.title,
            agentName: decision.agentName ?? decision.agentSlug,
            body: decision.payload.body,
            reasoning: decision.payload.reasoning,
            confidence: decision.payload.confidence,
            sourcesCount: decision.payload.sources?.count ?? 0,
            relativeTimestamp: decision.relativeCreatedAt,
            agentActions: agentActions,
            systemActions: systemActions,
            openInPanelURL: decision.deepLinkURLString
        )
    }

    private static func approveActions(for d: Decision) -> [DecisionActionIntent] {
        let approveLabel = d.payload.approveLabel ?? "Approve"
        let declineLabel = d.payload.declineLabel ?? "Decline"
        let recommended = d.payload.recommendation

        return [
            DecisionActionIntent(
                kind: .decline,
                label: declineLabel,
                isRecommended: recommended == "decline",
                resolveBody: .approve(approved: false, notes: nil),
                accessibilityLabel: "\(declineLabel) decision: \(d.title)"
            ),
            DecisionActionIntent(
                kind: .approve,
                label: approveLabel,
                isRecommended: recommended == "approve",
                resolveBody: .approve(approved: true, notes: nil),
                accessibilityLabel: "\(approveLabel) decision: \(d.title)"
            ),
        ]
    }

    private static func pickActions(for d: Decision) -> [DecisionActionIntent] {
        let options = d.payload.options ?? []
        let recommended = d.payload.recommendedOptionId
        var actions = options.map { option in
            DecisionActionIntent(
                kind: .pick(optionId: option.id),
                label: option.label,
                isRecommended: recommended == option.id,
                resolveBody: .pick(optionId: option.id, notes: nil),
                accessibilityLabel: "Pick: \(option.label)"
            )
        }
        if d.payload.allowNone == true {
            actions.append(DecisionActionIntent(
                kind: .pick(optionId: ""),
                label: "None of these",
                isRecommended: false,
                resolveBody: .pick(optionId: nil, notes: nil),
                accessibilityLabel: "Pick none of these"
            ))
        }
        return actions
    }

    private static func answerActions(for d: Decision) -> [DecisionActionIntent] {
        // Menubar answer cards render a small editor; no buttonised actions
        // beyond system row. We still expose a submit shim for completeness.
        var actions: [DecisionActionIntent] = []
        if let suggested = d.payload.suggestedAnswer, !suggested.isEmpty {
            actions.append(DecisionActionIntent(
                kind: .answerSubmit,
                label: "Use suggested",
                isRecommended: true,
                resolveBody: .answer(text: suggested, notes: nil),
                accessibilityLabel: "Submit suggested answer: \(suggested)"
            ))
        }
        return actions
    }

    private static func nextMorning() -> Date {
        var cal = Calendar.current
        cal.timeZone = .current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return cal.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }
}
