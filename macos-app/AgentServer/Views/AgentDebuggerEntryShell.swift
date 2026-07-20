import SwiftUI

struct AgentDebuggerEntryShell: View {
    let runId: String
    let actions: AgentDebuggerActions?
    let close: () -> Void
    let openAgentSettings: () -> Void
    let openRun: (String) -> Void

    var body: some View {
        TopDrawerSurface(
            title: "Agent debugger",
            closeLabel: "Close agent debugger",
            onClose: close,
            onEscape: close,
            titleIcon: "stethoscope"
        ) {
            if let actions {
                AgentDebuggerView(
                    failedRunId: runId,
                    actions: actions,
                    openAgentSettings: openAgentSettings,
                    openRun: openRun,
                    showsHeading: false
                )
            } else {
                unavailableState
            }
        }
    }

    private var unavailableState: some View {
        let presentation = AgentDebuggerPresentation.unavailableState
        return ContentUnavailableView {
            Label(presentation.title, systemImage: "exclamationmark.triangle")
        } description: {
            VStack(spacing: 4) {
                Text(presentation.message)
                Text("Run \(runId.prefix(8))")
            }
        } actions: {
            Button(presentation.actionTitle, action: openAgentSettings)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
