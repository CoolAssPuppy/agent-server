import SwiftUI
import AgentServerDesignSystem

struct TodayView: View {
    let presentation: TodayPresentation
    let loadingActionReference: String?
    let onAction: (TodayItem, PresentationAction) -> Void

    @Environment(\.nTheme) private var theme

    init(
        presentation: TodayPresentation,
        loadingActionReference: String? = nil,
        onAction: @escaping (TodayItem, PresentationAction) -> Void
    ) {
        self.presentation = presentation
        self.loadingActionReference = loadingActionReference
        self.onAction = onAction
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                header

                if presentation.isEmpty {
                    emptyState
                } else {
                    ForEach(presentation.sections) { section in
                        sectionView(section)
                    }
                }
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.vertical, NSpacing.xxl)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(theme.tokens.background)
        .accessibilityIdentifier("today.screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text("Today")
                .font(NTypography.displayMedium)
                .foregroundStyle(theme.tokens.foreground)
                .accessibilityAddTraits(.isHeader)
            Text("What needs you, what is working, and what happens next.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Label(presentation.emptyStateTitle, systemImage: "checkmark.circle.fill")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.success)
            Text(presentation.emptyStateExplanation)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .padding(NSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.lg))
    }

    private func sectionView(_ section: TodayPresentationSection) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Label(section.title, systemImage: section.section.symbolName)
                .font(NTypography.headlineMedium)
                .foregroundStyle(section.section.color(theme.tokens))
                .accessibilityAddTraits(.isHeader)

            VStack(spacing: 0) {
                ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider().opacity(0.25) }
                    TodayItemRow(
                        item: item,
                        isActionLoading: loadingActionReference == item.primaryAction.targetReference,
                        onAction: onAction
                    )
                }
            }
            .background(theme.tokens.card)
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        }
        .accessibilityIdentifier("today.section.\(section.section.contractName)")
    }
}

private struct TodayItemRow: View {
    let item: TodayItem
    let isActionLoading: Bool
    let onAction: (TodayItem, PresentationAction) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                Text(item.headline)
                    .font(NTypography.bodyLarge)
                    .fontWeight(.medium)
                    .foregroundStyle(theme.tokens.foreground)
                    .fixedSize(horizontal: false, vertical: true)

                Text(item.explanation)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)

                Text(timeLabel)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(item.section.color(theme.tokens))
            }

            Spacer(minLength: NSpacing.md)

            actionButton
        }
        .padding(NSpacing.lg)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var actionButton: some View {
        primaryActionButton
    }

    private var primaryActionButton: some View {
        Button {
            onAction(item, item.primaryAction)
        } label: {
            HStack(spacing: NSpacing.xs) {
                if isActionLoading {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(item.primaryAction.label)
            }
                .font(NTypography.labelMedium)
                .foregroundStyle(
                    item.section == .needsYou
                        ? theme.tokens.primaryForeground
                        : theme.tokens.foreground
                )
                .padding(.horizontal, NSpacing.md)
                .frame(height: 28)
                .background(
                    item.section == .needsYou
                        ? theme.tokens.primary
                        : theme.tokens.muted
                )
                .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        }
        .buttonStyle(.plain)
        .disabled(item.primaryAction.kind == .unknown || isActionLoading)
        .accessibilityIdentifier("today.primaryAction.\(item.id)")
    }

    private var timeLabel: String {
        if let expiresAt = item.expiresAt {
            return "Respond by \(expiresAt.formatted(date: .omitted, time: .shortened))"
        }
        if item.section == .upcoming {
            return item.date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        }
        return item.date.formatted(.relative(presentation: .named))
    }
}

private extension TodaySection {
    var contractName: String {
        switch self {
        case .needsYou: "needs_you"
        case .working: "working"
        case .finished: "finished"
        case .problems: "problems"
        case .upcoming: "upcoming"
        }
    }

    var symbolName: String {
        switch self {
        case .needsYou: "hand.raised.fill"
        case .working: "bolt.circle.fill"
        case .finished: "checkmark.circle.fill"
        case .problems: "exclamationmark.circle.fill"
        case .upcoming: "clock.fill"
        }
    }

    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .needsYou: tokens.accent
        case .working: tokens.warning
        case .finished: tokens.success
        case .problems: tokens.error
        case .upcoming: tokens.mutedForeground
        }
    }
}
