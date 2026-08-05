import SwiftUI
import AgentServerDesignSystem

struct AssistantHomeReadinessSection: View {
    let presentation: AssistantHomePresentation

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(spacing: NSpacing.xs) {
                Text(presentation.readinessLabel)
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Spacer()
            }
            Text(presentation.contract.readiness.summary.text)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            ForEach(Array(presentation.blockingChecks.enumerated()), id: \.offset) { _, check in
                Label(check.explanation.text, systemImage: check.state.symbol)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(check.state.color(theme.tokens))
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(Array(presentation.deferredChecks.enumerated()), id: \.offset) { _, check in
                Label(check.explanation.text, systemImage: check.state.symbol)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !presentation.passedChecks.isEmpty {
                DisclosureGroup("\(presentation.passedChecks.count) checks passed") {
                    VStack(alignment: .leading, spacing: NSpacing.xs) {
                        ForEach(Array(presentation.passedChecks.enumerated()), id: \.offset) { _, check in
                            Label(check.explanation.text, systemImage: "checkmark.circle")
                                .font(NTypography.bodySmall)
                                .foregroundStyle(theme.tokens.mutedForeground)
                        }
                    }
                    .padding(.top, NSpacing.xs)
                }
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}

struct AssistantHomeFactCard: View {
    let title: String
    let symbol: String
    let text: String
    let detail: String?

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Label(title, systemImage: symbol)
                .font(NTypography.labelMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(text)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}

struct AssistantHomeListSection<Content: View>: View {
    let title: String
    let emptyText: String
    let isEmpty: Bool
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title)
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                if isEmpty {
                    Text(emptyText)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                } else {
                    content()
                }
            }
            .padding(NSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.tokens.card)
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
    }
}

struct AssistantHomeConnectionRow: View {
    let connection: AssistantConnection

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            Image(systemName: connection.state.symbol)
                .foregroundStyle(connection.state.color(theme.tokens))
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                Text(connection.label)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text(connection.explanation.text)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
    }
}

struct AssistantHomeOutcomeRow: View {
    let outcome: AssistantRecentOutcome

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.sm) {
            Image(systemName: outcome.outcome.symbol)
                .foregroundStyle(outcome.outcome.color(theme.tokens))
            Text(outcome.headline.text)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Text(outcome.occurredAt.formatted(.relative(presentation: .named)))
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .contentShape(Rectangle())
    }
}

extension AssistantHomeTone {
    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .positive: tokens.success
        case .active: tokens.warning
        case .attention: tokens.error
        case .muted: tokens.mutedForeground
        }
    }
}

extension AssistantReadinessCheckState {
    var symbol: String {
        switch self {
        case .pass: "checkmark.circle"
        case .actionRequired: "hand.raised.circle"
        case .fail: "exclamationmark.circle.fill"
        case .unknownValue, .unknown: "questionmark.circle"
        }
    }

    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .pass: tokens.success
        case .actionRequired: tokens.warning
        case .fail: tokens.error
        case .unknownValue, .unknown: tokens.mutedForeground
        }
    }
}

extension AssistantPermissionEffect {
    var symbol: String {
        switch self {
        case .can: "checkmark.circle"
        case .mustAsk: "hand.raised.circle"
        case .cannot: "minus.circle"
        case .unknown: "questionmark.circle"
        }
    }
}

extension AssistantConnectionState {
    var symbol: String {
        switch self {
        case .ready: "checkmark.circle.fill"
        case .needsSetup: "link.badge.plus"
        case .unavailable: "exclamationmark.circle.fill"
        case .unknownValue, .unknown: "questionmark.circle"
        }
    }

    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .ready: tokens.success
        case .needsSetup: tokens.warning
        case .unavailable: tokens.error
        case .unknownValue, .unknown: tokens.mutedForeground
        }
    }
}

extension AssistantOutcomeState {
    var symbol: String {
        switch self {
        case .succeeded: "checkmark.circle.fill"
        case .working: "bolt.circle.fill"
        case .waiting: "hand.raised.circle.fill"
        case .failed, .partial: "exclamationmark.circle.fill"
        case .canceled, .skipped: "minus.circle"
        case .unknownValue, .unknown: "questionmark.circle"
        }
    }

    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .succeeded: tokens.success
        case .working: tokens.warning
        case .waiting: tokens.accent
        case .failed, .partial: tokens.error
        case .canceled, .skipped, .unknownValue, .unknown: tokens.mutedForeground
        }
    }
}
