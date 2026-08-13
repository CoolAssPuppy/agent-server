import SwiftUI
import AgentServerDesignSystem

/// Counts across the top of the security check: what is waiting on a person
/// first, then the groups that need nothing.
struct SecuritySummaryHeader: View {
    let summary: SecurityDashboardSummary

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: NSpacing.xs) {
                Image(systemName: headlineSymbol)
                    .foregroundStyle(headlineColor)
                    .accessibilityHidden(true)
                Text(summary.headline)
                    .font(NTypography.headlineSmall)
                    .foregroundStyle(theme.tokens.foreground)
            }
            if !summary.detail.isEmpty {
                Text(summary.detail)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            if !summary.counts.isEmpty {
                counts
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var counts: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            ForEach(summary.counts) { count in
                VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                    Text("\(count.count)")
                        .font(NTypography.headlineMedium)
                        .foregroundStyle(color(for: count.group))
                    Text(count.title)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(count.count) \(count.title.lowercased())")
            }
        }
        .padding(.top, NSpacing.xxs)
    }

    private var headlineSymbol: String {
        summary.needsApprovalCount > 0 ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"
    }

    private var headlineColor: Color {
        summary.totalCount == 0
            ? theme.tokens.mutedForeground
            : (summary.needsApprovalCount > 0 ? theme.tokens.warning : theme.tokens.success)
    }

    private func color(for group: SecurityAgentGroup) -> Color {
        switch group {
        case .needsApproval: theme.tokens.warning
        case .notChecked: theme.tokens.destructive
        case .approved, .clean: theme.tokens.foreground
        }
    }
}

/// One agent in the list. The group heading says what state the agent is in,
/// so a row carries at most one status of its own.
struct SecurityAgentListRow: View {
    let title: String
    let detail: String
    let status: String
    let severity: ConsumerRiskLevel?
    let isSelected: Bool
    var isWorking = false
    var showsDisclosure = true

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if !detail.isEmpty {
                    Text(detail)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: NSpacing.sm)
            trailing
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.sm)
        .contentShape(Rectangle())
        .background(isSelected ? theme.tokens.primary.opacity(0.08) : Color.clear)
        .help(title)
    }

    @ViewBuilder
    private var trailing: some View {
        if isWorking {
            ProgressView()
                .controlSize(.small)
        } else if !status.isEmpty {
            Text(status)
                .font(NTypography.caption)
                .foregroundStyle(statusColor)
                .fixedSize()
                .layoutPriority(1)
        }
        if showsDisclosure {
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(theme.tokens.mutedForeground)
                .accessibilityHidden(true)
        }
    }

    private var statusColor: Color {
        guard let severity else {
            return status == "Could not check" ? theme.tokens.destructive : theme.tokens.mutedForeground
        }
        switch severity {
        case .low: return theme.tokens.success
        case .needsReview: return theme.tokens.warning
        case .high, .critical: return theme.tokens.destructive
        }
    }
}

struct SecurityAgentSearchField: View {
    @Binding var query: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.tokens.mutedForeground)
                .accessibilityHidden(true)
            TextField("Find an agent", text: $query)
                .textFieldStyle(.plain)
                .font(NTypography.bodyMedium)
                .onExitCommand { query = "" }
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear the search")
            }
        }
        .padding(.horizontal, NSpacing.sm)
        .frame(height: 30)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .accessibilityIdentifier("security.search")
    }
}
