import SwiftUI
import NerdsUI

struct AgentSafetyReadinessRow: View {
    let presentation: AgentSafetyReadinessPresentation
    let action: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: NSpacing.md) {
                Image(systemName: presentation.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(statusColor)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                    Text(presentation.title)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    Text(presentation.detail)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: NSpacing.md)
                Image(systemName: "chevron.right")
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, NSpacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Safety and readiness, \(presentation.title), \(presentation.detail)")
        .accessibilityHint(presentation.action == .openSettings
            ? "Opens agent settings"
            : "Opens the security check")
        .accessibilityIdentifier("agentDetail.safetyReadiness")
    }

    private var statusColor: Color {
        switch presentation.risk {
        case .low: return theme.tokens.success
        case .needsReview: return theme.tokens.warning
        case .high, .critical: return theme.tokens.error
        case nil: return theme.tokens.mutedForeground
        }
    }
}
