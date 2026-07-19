import SwiftUI
import NerdsUI

struct SecurityScanProgressView: View {
    let state: SecurityBackgroundScanState
    let failure: ConsumerFlowFailure?
    let retry: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                progressHeader
                agentList
                if let failure {
                    ConsumerFlowFailureView(failure: failure, retry: retry)
                }
            }
            .frame(maxWidth: 760)
            .padding(NSpacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(state.accessibilitySummary)
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(progressTitle)
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)
            Text(progressExplanation)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
            ProgressView(value: Double(state.processedCount), total: Double(max(state.agents.count, 1)))
                .accessibilityLabel("Security check progress")
                .accessibilityValue("\(state.processedCount) of \(state.agents.count) agents checked")
        }
    }

    private var progressTitle: String {
        if state.phase == .failed { return "Security check needs attention" }
        return "Checking \(state.processedCount + 1) of \(state.agents.count)"
    }

    private var progressExplanation: String {
        if let current = state.currentAgent {
            return "Analyzing \(current.name) now. Each agent is checked separately on this Mac."
        }
        return "The check finished the remaining agents. Review the error below, then try again."
    }

    private var agentList: some View {
        VStack(spacing: 0) {
            ForEach(Array(state.agents.enumerated()), id: \.element.id) { index, agent in
                if index > 0 { Divider().opacity(0.25) }
                HStack(spacing: NSpacing.md) {
                    statusIcon(agent.status)
                        .frame(width: 20, height: 20)
                    Text(agent.name)
                        .font(NTypography.bodyMedium)
                    Spacer()
                    Text(statusLabel(agent.status))
                        .font(NTypography.caption)
                        .foregroundStyle(statusColor(agent.status))
                }
                .padding(.horizontal, NSpacing.lg)
                .padding(.vertical, NSpacing.md)
                .accessibilityElement(children: .combine)
            }
        }
        .background(theme.tokens.card)
        .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    @ViewBuilder
    private func statusIcon(_ status: SecurityScanAgentStatus) -> some View {
        switch status {
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(theme.tokens.mutedForeground)
        case .analyzing:
            ProgressView().controlSize(.small)
        case .complete:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.tokens.success)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(theme.tokens.destructive)
        }
    }

    private func statusLabel(_ status: SecurityScanAgentStatus) -> String {
        switch status {
        case .pending: "Waiting"
        case .analyzing: "Checking"
        case .complete: "Checked"
        case .failed: "Could not check"
        }
    }

    private func statusColor(_ status: SecurityScanAgentStatus) -> Color {
        switch status {
        case .failed: theme.tokens.destructive
        case .complete: theme.tokens.success
        case .pending, .analyzing: theme.tokens.mutedForeground
        }
    }
}
