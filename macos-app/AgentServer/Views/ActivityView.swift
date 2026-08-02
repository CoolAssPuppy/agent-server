import SwiftUI
import AgentServerDesignSystem

struct ActivityView: View {
    let items: [ActivityItem]
    let onOpen: (ActivityItem) -> Void

    @Environment(\.nTheme) private var theme
    @State private var filter = ActivityFilter.all
    @State private var searchText = ""

    private var presentation: ActivityPresentation {
        ActivityPresentation(items: items, filter: filter, searchText: searchText)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().opacity(0.3)
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .accessibilityIdentifier("activity.screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("Activity")
                    .font(NTypography.displayMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .accessibilityAddTraits(.isHeader)
                Text("Search the history of work performed by assistants on this Mac.")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }

            VStack(alignment: .leading, spacing: NSpacing.sm) {
                HStack(spacing: NSpacing.sm) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .accessibilityHidden(true)
                    TextField("Search activity", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(NTypography.bodyMedium)
                        .accessibilityIdentifier("activity.search")
                }
                .padding(.horizontal, NSpacing.md)
                .frame(height: 34)
                .background(theme.tokens.card)
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: NRadius.md)
                        .stroke(theme.tokens.border, lineWidth: 1)
                )

                HStack(spacing: NSpacing.xs) {
                    ForEach(ActivityFilter.allCases) { option in
                        filterButton(option)
                    }
                }
            }
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.top, NSpacing.xxl)
        .padding(.bottom, NSpacing.lg)
        .frame(maxWidth: 820, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var content: some View {
        if presentation.isEmpty {
            Text(presentation.emptyStateExplanation)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .padding(NSpacing.xl)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: NSpacing.xl) {
                    ForEach(presentation.groups()) { group in
                        VStack(alignment: .leading, spacing: NSpacing.sm) {
                            Text(group.title)
                                .font(NTypography.labelMedium)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .accessibilityAddTraits(.isHeader)

                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                    if index > 0 { Divider().opacity(0.25) }
                                    ActivityItemRow(item: item, onOpen: onOpen)
                                }
                            }
                            .background(theme.tokens.card)
                            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
                        }
                    }
                }
                .padding(.horizontal, NSpacing.xxl)
                .padding(.vertical, NSpacing.xl)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func filterButton(_ option: ActivityFilter) -> some View {
        Button {
            filter = option
        } label: {
            Text(option.title)
                .font(NTypography.labelMedium)
                .foregroundStyle(filter == option ? theme.tokens.primaryForeground : theme.tokens.foreground)
                .padding(.horizontal, NSpacing.md)
                .frame(height: 30)
                .background(filter == option ? theme.tokens.primary : theme.tokens.muted)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.accessibilityLabel)
        .accessibilityAddTraits(filter == option ? .isSelected : [])
        .accessibilityIdentifier("activity.filter.\(option.rawValue)")
    }
}

private struct ActivityItemRow: View {
    let item: ActivityItem
    let onOpen: (ActivityItem) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        Button {
            onOpen(item)
        } label: {
            HStack(alignment: .top, spacing: NSpacing.md) {
                Image(systemName: item.state.symbolName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(item.state.color(theme.tokens))
                    .frame(width: 18, height: 18)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text(item.assistantName)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Text(item.headline)
                        .font(NTypography.bodyLarge)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.tokens.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    if let summary = item.outcomeSummary {
                        Text(summary)
                            .font(NTypography.bodySmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .lineLimit(2)
                    }
                    if let output = item.primaryOutput {
                        Label(output, systemImage: "arrow.up.right.square")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.success)
                    }
                }

                Spacer(minLength: NSpacing.md)

                VStack(alignment: .trailing, spacing: NSpacing.xs) {
                    Text(item.state.label)
                        .font(NTypography.badge)
                        .foregroundStyle(item.state.color(theme.tokens))
                    Text(item.startedAt.formatted(.relative(presentation: .named)))
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .accessibilityHidden(true)
                }
            }
            .padding(NSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.assistantName), \(item.headline), \(item.state.label)")
        .accessibilityHint("Opens the run review")
        .accessibilityIdentifier("activity.item.\(item.id)")
    }
}

private extension ActivityState {
    var label: String {
        switch self {
        case .needsYou: "Needs you"
        case .working: "Working"
        case .finished: "Finished"
        case .problem: "Problem"
        }
    }

    var symbolName: String {
        switch self {
        case .needsYou: "hand.raised.fill"
        case .working: "bolt.circle.fill"
        case .finished: "checkmark.circle.fill"
        case .problem: "exclamationmark.circle.fill"
        }
    }

    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .needsYou: tokens.accent
        case .working: tokens.warning
        case .finished: tokens.success
        case .problem: tokens.error
        }
    }
}
