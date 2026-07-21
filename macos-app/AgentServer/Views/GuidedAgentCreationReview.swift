import SwiftUI
import AgentServerDesignSystem

extension GuidedAgentCreationView {
    func proposalStep(_ proposal: AgentProposalPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(title: "Review your agent")
            AgentProposalView(proposal: proposal)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationReview)
        }
    }

    var completionStep: some View {
        ConsumerSection("Agent saved") {
            Label(completionMessage, systemImage: "checkmark.circle")
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.success)
        }
    }

    var completionMessage: String {
        model.flow.safeTestState == .stopped
            ? "Your agent is saved. The safe test was stopped."
            : "Your agent is ready."
    }

    var footer: some View {
        HStack(spacing: NSpacing.sm) {
            Spacer()
            if model.flow.canGoBack {
                Button("Back", action: goBack)
                    .accessibilityIdentifier(ConsumerFlowAccessibility.creationBack)
                Spacer().frame(width: NSpacing.sm)
            }
            Button("Cancel", action: onCancel)
                .keyboardShortcut(.cancelAction)
                .disabled(model.isBusy)
            footerActions
        }
        .padding(.horizontal, NSpacing.xl)
        .frame(height: WindowFooterMetrics.height)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider().opacity(WindowFooterMetrics.dividerOpacity)
        }
    }

    @ViewBuilder
    var footerActions: some View {
        switch model.flow.phase {
        case .request:
            Button("Continue", action: startPreparation)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(model.request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationContinue)
        case .questions:
            questionFooterAction
        case .proposal:
            proposalFooterAction
        case .testing:
            if let runId = model.flow.safeTestRunId {
                Button("Open run") { onOpenRun(runId) }
                Button("Stop test", action: stopSafeTest)
                    .buttonStyle(.borderedProminent)
            }
        case .failed:
            if let runId = model.flow.failedSafeTestRunId {
                Button("Open Agent Debugger") { onTestFailed(runId) }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        case .complete:
            Button("Done", action: onCancel)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    var questionFooterAction: some View {
        if !model.flow.connectionQuestions.isEmpty {
            Button("Continue", action: submitConnectionSetup)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!model.flow.areConnectionQuestionsAnswered)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationContinue)
        } else if model.flow.nextQuestion?.requiresConnectionSetup != true,
                  model.flow.nextQuestion?.isUnavailable != true {
            Button("Continue", action: answerQuestion)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canSubmitCurrentAnswer)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationContinue)
        }
    }

    @ViewBuilder
    var proposalFooterAction: some View {
        if let proposal = model.flow.proposal, !proposal.readiness.canSave {
            Button(proposal.readiness.primaryActionTitle, action: requestConnectionSetup)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(setUpConnections == nil)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationConnectionSetup)
        } else {
            Button("Save agent") { requestSave(runSafeTest: false) }
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationSave)
            Button("Save and run a safe test") { requestSave(runSafeTest: true) }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier(ConsumerFlowAccessibility.creationSaveAndTest)
        }
    }
}
