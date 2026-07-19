import SwiftUI
import NerdsUI

struct AgentRunControl: View {
    let agent: Agent
    @ObservedObject var monitor: StatusMonitor
    let onOpenSettings: () -> Void
    let onReviewSecurity: () -> Void
    let onOpenRun: (String) -> Void

    @Environment(\.nTheme) private var theme
    @State private var state = AgentRunTriggerState.idle

    private var isRunning: Bool {
        monitor.activeRuns.contains { $0.agentId == agent.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(spacing: NSpacing.sm) {
                runButton
                if !agent.enabled { pausedBadge }
                Spacer()
            }

            if let feedback = state.presentation {
                feedbackView(feedback)
            }
        }
    }

    private var runButton: some View {
        Button(action: startRun) {
            HStack(spacing: NSpacing.xs) {
                if isRunning || state.isStarting {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(theme.tokens.primaryForeground)
                } else {
                    Image(systemName: "play.fill")
                }
                Text(runButtonTitle)
                    .font(NTypography.bodyMedium)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.xs)
            .foregroundStyle(theme.tokens.primaryForeground)
            .background(
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .fill(theme.tokens.primary)
            )
        }
        .buttonStyle(.plain)
        .disabled(isRunning || state.isStarting || !agent.enabled)
        .accessibilityIdentifier("agentDetail.runNow")
    }

    private var runButtonTitle: String {
        if isRunning { return "Running…" }
        if state.isStarting { return "Starting…" }
        return "Run now"
    }

    private var pausedBadge: some View {
        Text("Paused")
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
            .padding(.horizontal, NSpacing.xs)
            .padding(.vertical, 2)
            .background(theme.tokens.muted)
            .clipShape(Capsule())
    }

    private func feedbackView(_ feedback: AgentRunTriggerFeedback) -> some View {
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
                Button(feedback.recoveryTitle) {
                    recover(feedback.recovery)
                }
                .buttonStyle(.link)
                .accessibilityIdentifier("agentDetail.runRecovery")
            }
            Spacer(minLength: 0)
        }
        .padding(NSpacing.sm)
        .background(theme.tokens.card)
        .overlay {
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.border, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agentDetail.runFeedback")
    }

    private func startRun() {
        state = .starting
        Task {
            state = await monitor.triggerRun(agentId: agent.id)
        }
    }

    private func recover(_ recovery: AgentRunTriggerRecovery) {
        switch recovery {
        case .retry:
            startRun()
        case .openAgentSettings:
            onOpenSettings()
        case .reviewSecurity:
            onReviewSecurity()
        case .openRun:
            guard let runId = state.startedRunId else { return }
            onOpenRun(runId)
        }
    }
}
