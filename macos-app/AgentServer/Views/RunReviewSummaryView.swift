import SwiftUI
import AgentServerDesignSystem

struct RunReviewSummaryView: View {
    let review: RunReview

    @Environment(\.nTheme) private var theme

    private var presentation: RunReviewPresentation {
        RunReviewPresentation(review: review)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                outcomeHeader

                ForEach(Array(presentation.sections.enumerated()), id: \.offset) { _, section in
                    ConsumerSection(section.title) {
                        VStack(alignment: .leading, spacing: NSpacing.sm) {
                            ForEach(Array(section.statements.enumerated()), id: \.offset) { _, item in
                                statementRow(item, kind: section.kind)
                            }
                        }
                    }
                }

                if !review.timeline.isEmpty {
                    ConsumerSection("What happened") {
                        VStack(alignment: .leading, spacing: NSpacing.md) {
                            ForEach(Array(review.timeline.enumerated()), id: \.offset) { index, entry in
                                timelineRow(entry, isLast: index == review.timeline.count - 1)
                            }
                        }
                    }
                }
            }
            .padding(NSpacing.xl)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(theme.tokens.background)
        .accessibilityIdentifier("runReview.summary")
    }

    private var outcomeHeader: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            Image(systemName: presentation.symbolName)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(outcomeColor)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text(presentation.outcomeLabel)
                    .font(NTypography.labelMedium)
                    .foregroundStyle(outcomeColor)
                Text(review.headline.text)
                    .font(NTypography.headlineLarge)
                    .foregroundStyle(theme.tokens.foreground)
                    .accessibilityAddTraits(.isHeader)
                Text(review.summary.text)
                    .font(NTypography.bodyLarge)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func statementRow(
        _ statement: PresentationStatement,
        kind: RunReviewSectionKind
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: NSpacing.sm) {
            Image(systemName: sectionSymbol(kind))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(sectionColor(kind))
                .accessibilityHidden(true)
            Text(statement.text)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }

    private func timelineRow(_ entry: HumanTimelineEntry, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: NSpacing.md) {
            VStack(spacing: 0) {
                Circle()
                    .fill(isLast ? outcomeColor : theme.tokens.mutedForeground.opacity(0.55))
                    .frame(width: 8, height: 8)
                if !isLast {
                    Rectangle()
                        .fill(theme.tokens.border)
                        .frame(width: 1, height: 24)
                }
            }
            .padding(.top, 5)

            Text(entry.label.text)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var outcomeColor: Color {
        switch presentation.tone {
        case .positive: theme.tokens.success
        case .caution: theme.tokens.warning
        case .negative: theme.tokens.error
        case .neutral: theme.tokens.mutedForeground
        }
    }

    private func sectionSymbol(_ kind: RunReviewSectionKind) -> String {
        switch kind {
        case .outputs: "arrow.up.right.square"
        case .changes: "pencil.line"
        case .problems: "exclamationmark.circle"
        case .suggestions: "lightbulb"
        }
    }

    private func sectionColor(_ kind: RunReviewSectionKind) -> Color {
        switch kind {
        case .outputs: theme.tokens.success
        case .changes: theme.tokens.accent
        case .problems: theme.tokens.error
        case .suggestions: theme.tokens.warning
        }
    }
}
