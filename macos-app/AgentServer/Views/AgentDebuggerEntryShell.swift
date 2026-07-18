import SwiftUI
import NerdsUI

struct AgentDebuggerEntryShell: View {
    let runId: String
    let actions: AgentDebuggerActions?
    let close: () -> Void
    let openAgentSettings: () -> Void
    let openRun: (String) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            closeBar
            Divider().opacity(0.3)
            if let actions {
                AgentDebuggerView(
                    failedRunId: runId,
                    actions: actions,
                    openAgentSettings: openAgentSettings,
                    openRun: openRun
                )
            } else {
                unavailableState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
    }

    private var closeBar: some View {
        HStack {
            Button(action: close) {
                Label("Close agent debugger", systemImage: "xmark")
                    .labelStyle(.iconOnly)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .keyboardShortcut("w", modifiers: .command)
            .accessibilityLabel("Close agent debugger")
            Spacer()
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
    }

    private var unavailableState: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(
                title: "Agent debugger",
                explanation: "This guided check will explain what happened and let you review a fix."
            )
            ConsumerSection("Run selected") {
                Label("Run \(runId.prefix(8))", systemImage: "exclamationmark.triangle")
                    .font(NTypography.bodyMedium)
                Text("The run is preserved in run history. Guided diagnosis is not available for this run yet.")
                    .font(NTypography.bodyLarge)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            ConsumerSection("What you can do now") {
                Button("Open agent settings", action: openAgentSettings)
            }
            Spacer()
        }
        .frame(maxWidth: 720, maxHeight: .infinity, alignment: .topLeading)
        .padding(NSpacing.xl)
    }
}
