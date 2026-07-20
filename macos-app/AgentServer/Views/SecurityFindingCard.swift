import SwiftUI
import AgentServerDesignSystem

struct SecuritySectionLabel: View {
    let title: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        Text(title.uppercased())
            .font(NTypography.labelSmall)
            .tracking(0.8)
            .foregroundStyle(theme.tokens.mutedForeground)
    }
}

struct SecurityGroupedSurface<Content: View>: View {
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .background(theme.tokens.background)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}

struct SecurityRiskStatus: View {
    let risk: ConsumerRiskLevel
    var isProminent = false

    @Environment(\.nTheme) private var theme

    var body: some View {
        Label(risk.title, systemImage: symbolName)
            .font(isProminent ? NTypography.bodyMedium : NTypography.caption)
            .foregroundStyle(color)
            .accessibilityLabel("Risk: \(risk.title)")
    }

    private var symbolName: String {
        switch risk {
        case .low: "checkmark.circle.fill"
        case .needsReview: "exclamationmark.triangle.fill"
        case .high, .critical: "exclamationmark.octagon.fill"
        }
    }

    private var color: Color {
        switch risk {
        case .low: theme.tokens.success
        case .needsReview: theme.tokens.warning
        case .high, .critical: theme.tokens.destructive
        }
    }
}

struct SecurityFindingRow: View {
    let finding: SecurityFindingPresentation
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        let row = finding.securityRow(isSelected: isSelected)
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: NSpacing.md) {
                Image(systemName: riskSymbol)
                    .foregroundStyle(riskColor)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                    Text(row.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(theme.tokens.foreground)
                    Text(row.detail)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(2)
                }
                Spacer(minLength: NSpacing.sm)
                Text(row.status)
                    .font(NTypography.caption)
                    .foregroundStyle(riskColor)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.sm)
            .contentShape(Rectangle())
            .background(isSelected ? theme.tokens.primary.opacity(0.08) : Color.clear)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(ConsumerFlowAccessibility.securityFindingPrefix + finding.id)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var riskSymbol: String {
        switch finding.severity {
        case .low: "checkmark.circle"
        case .needsReview: "exclamationmark.triangle"
        case .high, .critical: "exclamationmark.octagon"
        }
    }

    private var riskColor: Color {
        switch finding.severity {
        case .low: theme.tokens.success
        case .needsReview: theme.tokens.warning
        case .high, .critical: theme.tokens.destructive
        }
    }
}

struct SecurityFindingDetail: View {
    let finding: SecurityFindingPresentation
    let reviewFix: (() -> Void)?
    let ignore: (() -> Void)?

    @Environment(\.nTheme) private var theme
    @State private var showsDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                SecurityRiskStatus(risk: finding.severity)
                Text(finding.title)
                    .font(.system(size: 15, weight: .semibold))
                Text(finding.whyItMatters)
                    .font(.system(size: 13))
                Text(finding.potentialImpact)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                SecuritySectionLabel(title: "Recommended change")
                Text(finding.recommendation)
                    .font(.system(size: 13))
                Text(finding.functionalityImpact)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }

            HStack(spacing: NSpacing.sm) {
                if finding.canFix, let reviewFix {
                    Button("Review fix", action: reviewFix)
                        .buttonStyle(.borderedProminent)
                }
                if let ignore {
                    Button("Ignore", action: ignore)
                }
                Button(showsDetails ? "Hide details" : "Details") {
                    showsDetails.toggle()
                }
                Spacer()
            }
            .controlSize(.small)

            if showsDetails {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    SecuritySectionLabel(title: "Triggered by")
                    Text(finding.trigger)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .textSelection(.enabled)
                }
                .accessibilityElement(children: .contain)
            }
        }
        .accessibilityIdentifier(ConsumerFlowAccessibility.securityFindingPrefix + finding.id)
    }
}
