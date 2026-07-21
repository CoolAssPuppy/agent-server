import AgentServerDesignSystem
import SwiftUI

struct AgentRunFeedbackView: View {
    let state: AgentRunTriggerState
    let feedback: AgentRunTriggerFeedback
    let onRecover: (AgentRunTriggerRecovery) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            Image(systemName: state.startedRunId == nil
                ? "exclamationmark.circle.fill"
                : "checkmark.circle.fill")
                .foregroundStyle(state.startedRunId == nil
                    ? theme.tokens.warning
                    : theme.tokens.success)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                Text(feedback.title)
                    .font(NTypography.bodyMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.tokens.foreground)
                Text(feedback.message)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                Button(feedback.recoveryTitle) {
                    onRecover(feedback.recovery)
                }
                .buttonStyle(.link)
                .accessibilityIdentifier("agentDetail.runRecovery")
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, NSpacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agentDetail.runFeedback")
    }
}
