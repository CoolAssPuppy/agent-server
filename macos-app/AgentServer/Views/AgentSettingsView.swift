import AgentServerDesignSystem
import SwiftUI

private let emptyAgentSettingsSnapshot = AgentSettingsSnapshot(
    id: "",
    name: "",
    description: nil,
    prompt: "",
    enabled: true,
    schedule: nil,
    executor: nil,
    model: nil,
    provider: nil,
    capabilities: [:]
)

struct AgentSettingsSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let agentId: String
    @Binding var isPresented: Bool
    var onDeleted: () -> Void = {}

    @Environment(\.nTheme) private var theme
    @State private var draft = AgentSettingsDraft(snapshot: emptyAgentSettingsSnapshot)
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var connectTarget: AgentSettingsConnectTarget?

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            AgentSettingsForm(
                agent: agent,
                agentId: agentId,
                draft: $draft,
                onToggleCapability: toggleCapability,
                onDelete: deleteAgent
            )
            Divider().opacity(0.3)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .onAppear(perform: seedIfNeeded)
        .sheet(item: $connectTarget) { target in
            AgentSettingsConnectSheet(monitor: monitor, target: target) { didConnect in
                if didConnect { draft.setCapability(target.capability.id, enabled: true) }
                connectTarget = nil
            }
        }
    }

    private var header: some View {
        HStack(spacing: NSpacing.sm) {
            Text("Edit agent")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Toggle(isOn: $draft.enabled) {
                Text("Enabled")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .toggleStyle(.switch)
            .controlSize(.small)
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var footer: some View {
        HStack(spacing: NSpacing.sm) {
            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.error)
                    .textSelection(.enabled)
                    .accessibilityLabel("Save error: \(errorMessage)")
            }
            Spacer()
            Button("Cancel") { isPresented = false }
                .keyboardShortcut(.cancelAction)
            Button(action: save) {
                if isSaving { ProgressView().controlSize(.small) }
                else { Text("Save") }
            }
            .keyboardShortcut(.defaultAction)
            .disabled(isSaving || !draft.isValid)
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private func seedIfNeeded() {
        guard draft.sourceAgentId.isEmpty, let agent else { return }
        draft = AgentSettingsDraft(snapshot: agent.settingsSnapshot)
    }

    private func toggleCapability(_ capability: AgentCapability, _ isEnabled: Bool) {
        if isEnabled && !capability.envReady && !capability.requiredEnv.isEmpty {
            connectTarget = AgentSettingsConnectTarget(capability: capability)
            return
        }
        draft.setCapability(capability.id, enabled: isEnabled)
        errorMessage = nil
    }

    private func save() {
        guard AgentSettingsSelectionPolicy.canSaveDraft(
            seededAgentId: draft.sourceAgentId.isEmpty ? nil : draft.sourceAgentId,
            targetAgentId: agentId
        ) else {
            errorMessage = "This editor belongs to another agent. Close it and try again."
            return
        }
        guard agent != nil else {
            isPresented = false
            return
        }
        let patch = draft.patch
        guard !patch.isEmpty else {
            isPresented = false
            return
        }

        isSaving = true
        Task {
            let outcome = await monitor.updateAgent(id: agentId, settingsPatch: patch)
            isSaving = false
            switch outcome {
            case .success: isPresented = false
            case .missingEnv(let keys):
                errorMessage = "Missing connection keys: \(keys.joined(separator: ", "))"
            case .failure(let message): errorMessage = message
            }
        }
    }

    private func deleteAgent() {
        Task {
            switch await monitor.deleteAgent(id: agentId) {
            case .success:
                isPresented = false
                onDeleted()
            case .missingEnv, .failure:
                errorMessage = "Could not delete the agent."
            }
        }
    }
}
