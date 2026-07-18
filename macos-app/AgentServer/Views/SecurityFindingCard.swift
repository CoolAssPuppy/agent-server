import SwiftUI
import NerdsUI

struct SecurityFindingCard: View {
    let finding: SecurityFindingPresentation
    let reviewFix: (() -> Void)?
    let ignore: (() -> Void)?

    @Environment(\.nTheme) private var theme
    @State private var showsDetails = false

    var body: some View {
        ConsumerSection(finding.title) {
            HStack {
                ConsumerRiskLabel(risk: finding.severity)
                Spacer()
            }
            Text(finding.whyItMatters)
                .font(NTypography.bodyLarge)
            Text("What could happen")
                .font(NTypography.bodyMedium)
            Text(finding.potentialImpact)
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.mutedForeground)
            Divider().opacity(0.5)
            Text("Recommended change")
                .font(NTypography.bodyMedium)
            Text(finding.recommendation)
                .font(NTypography.bodyLarge)
            Text(finding.functionalityImpact)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            HStack {
                if finding.canFix, let reviewFix {
                    Button("Review fix", action: reviewFix)
                        .buttonStyle(.borderedProminent)
                }
                if let ignore {
                    Button("Ignore", action: ignore)
                }
                Spacer()
            }
            DisclosureGroup("Advanced details", isExpanded: $showsDetails) {
                Text("Triggered by: \(finding.trigger)")
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.top, NSpacing.xs)
            }
        }
        .accessibilityIdentifier(ConsumerFlowAccessibility.securityFindingPrefix + finding.id)
    }
}
