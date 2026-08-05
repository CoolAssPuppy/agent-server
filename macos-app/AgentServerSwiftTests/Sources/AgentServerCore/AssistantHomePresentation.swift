import Foundation

enum AssistantHomeTone: Equatable, Sendable {
    case positive, active, attention, muted
}

struct AssistantHomeHealthPresentation: Equatable, Sendable {
    let label: String
    let symbol: String
    let tone: AssistantHomeTone
}

struct AssistantPermissionLine: Equatable, Sendable {
    let text: String
    let effect: AssistantPermissionEffect
    let sourceRuleReference: String
}

struct AssistantHomePresentation: Equatable, Sendable {
    let contract: AssistantHomeContract
    let health: AssistantHomeHealthPresentation
    let primaryAction: PresentationAction?
    let blockingChecks: [AssistantReadinessCheck]
    let deferredChecks: [AssistantReadinessCheck]
    let passedChecks: [AssistantReadinessCheck]
    let permissionLines: [AssistantPermissionLine]
    let recentOutcomes: [AssistantRecentOutcome]
    let isAdvancedExpandedByDefault: Bool

    var readinessLabel: String {
        switch contract.readiness.state {
        case .ready: "Ready"
        case .needsSetup: "Needs setup"
        case .blocked: "Blocked"
        case .checking: "Checking readiness"
        case .unavailable, .unknown: "Readiness could not be verified"
        }
    }

    var scheduleText: String { contract.schedule.summary.text }
    var destinationText: String? { contract.destination?.text }

    init(contract: AssistantHomeContract) {
        self.contract = contract
        health = Self.healthPresentation(for: contract.health.state)
        primaryAction = contract.primaryAction.kind == .unknown ? nil : contract.primaryAction
        blockingChecks = contract.readiness.checks.filter {
            $0.state == .fail || $0.state == .actionRequired
        }
        deferredChecks = contract.readiness.checks.filter {
            switch $0.state {
            case .pass, .fail, .actionRequired: false
            case .unknownValue, .unknown: true
            }
        }
        passedChecks = contract.readiness.checks.filter { $0.state == .pass }
        permissionLines = contract.permissions.compactMap(Self.permissionLine)
        recentOutcomes = contract.recentOutcomes.enumerated()
            .sorted { left, right in
                if left.element.occurredAt == right.element.occurredAt {
                    return left.offset < right.offset
                }
                return left.element.occurredAt > right.element.occurredAt
            }
            .map(\.element)
        isAdvancedExpandedByDefault = false
    }

    private static func healthPresentation(
        for state: AssistantHealthState
    ) -> AssistantHomeHealthPresentation {
        switch state {
        case .healthy:
            AssistantHomeHealthPresentation(
                label: "Healthy",
                symbol: "checkmark.circle.fill",
                tone: .positive
            )
        case .working:
            AssistantHomeHealthPresentation(
                label: "Working",
                symbol: "bolt.circle.fill",
                tone: .active
            )
        case .needsAttention, .unknown:
            AssistantHomeHealthPresentation(
                label: "Needs attention",
                symbol: "exclamationmark.circle.fill",
                tone: .attention
            )
        case .paused:
            AssistantHomeHealthPresentation(
                label: "Paused",
                symbol: "pause.circle.fill",
                tone: .muted
            )
        }
    }

    private static func permissionLine(
        _ statement: AssistantPermissionStatement
    ) -> AssistantPermissionLine? {
        guard let effect = effectPhrase(statement.effect),
              let action = actionPhrase(statement.action) else { return nil }
        return AssistantPermissionLine(
            text: "\(effect) \(action) \(statement.targetLabel)",
            effect: statement.effect,
            sourceRuleReference: statement.sourceRuleReference
        )
    }

    private static func effectPhrase(_ effect: AssistantPermissionEffect) -> String? {
        switch effect {
        case .can: "Can"
        case .mustAsk: "Must ask before it can"
        case .cannot: "Cannot"
        case .unknown: nil
        }
    }

    private static func actionPhrase(_ action: AssistantPermissionAction) -> String? {
        switch action {
        case .read: "read"
        case .edit: "edit"
        case .execute: "run"
        case .send: "send to"
        case .publish: "publish to"
        case .delete: "delete"
        case .connect: "connect to"
        case .unknown: nil
        }
    }
}
