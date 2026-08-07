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
    var isEmbedded = false
    var onFinished: () -> Void = {}
    var onDeleted: () -> Void = {}

    @Environment(\.nTheme) private var theme
    @State private var draft = AgentSettingsDraft(snapshot: emptyAgentSettingsSnapshot)
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var saveFeedback: AgentSettingsSaveFeedback?
    @State private var connectTarget: AgentSettingsConnectTarget?
    @State private var authoritativeAgent: Agent?
    @State private var runtimeCompatibility: AgentRuntimeCompatibility?
    @State private var isCheckingRuntime = false

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    private var displayedAgent: Agent? {
        authoritativeAgent ?? agent
    }

    var body: some View {
        VStack(spacing: 0) {
            if !isEmbedded {
                header
                Divider().opacity(0.3)
            }
            AgentSettingsForm(
                monitor: monitor,
                agent: displayedAgent,
                agentId: agentId,
                draft: $draft,
                runtimeCompatibility: runtimeCompatibility,
                isCheckingRuntime: isCheckingRuntime,
                onToggleCapability: toggleCapability,
                onDelete: deleteAgent
            )
            Divider().opacity(0.3)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
        .onAppear(perform: seedIfNeeded)
        .onChange(of: agent?.id) { _, _ in seedIfNeeded() }
        .onChange(of: draft) { _, updatedDraft in
            if updatedDraft.isDirty { saveFeedback = nil }
        }
        .onChange(of: draft.runtime.choice) { _, _ in
            checkRuntimeCompatibility()
        }
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
            } else if let saveFeedback {
                Label(saveFeedback.message, systemImage: saveFeedback.systemImage)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.success)
            }
            Spacer()
            if AgentSettingsSavePresentation.showsActions(isDirty: draft.isDirty) {
                Button("Cancel", action: resetDraft)
                    .keyboardShortcut(.cancelAction)
                Button(action: save) {
                    if isSaving { ProgressView().controlSize(.small) }
                    else { Text("Save") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isSaving || !draft.isValid || isRuntimeSelectionBlocked)
            }
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private func seedIfNeeded() {
        guard draft.sourceAgentId.isEmpty, let agent else { return }
        authoritativeAgent = agent
        draft = AgentSettingsDraft(snapshot: agent.settingsSnapshot)
        checkRuntimeCompatibility()
    }

    private func resetDraft() {
        guard let authoritativeAgent else { return }
        draft = AgentSettingsDraft(snapshot: authoritativeAgent.settingsSnapshot)
        errorMessage = nil
        saveFeedback = nil
        checkRuntimeCompatibility()
    }

    private var isRuntimeSelectionBlocked: Bool {
        draft.hasRuntimeChanges && runtimeCompatibility?.canSelect != true
    }

    private func checkRuntimeCompatibility() {
        let executor = draft.runtime.resolvedExecutor ?? "claude-code"
        isCheckingRuntime = true
        runtimeCompatibility = nil
        Task {
            do {
                runtimeCompatibility = try await monitor.runtimeCompatibility(
                    id: agentId,
                    executor: executor
                )
            } catch {
                runtimeCompatibility = AgentRuntimeCompatibility(
                    state: .blocked,
                    issues: [AgentRuntimeCompatibilityIssue(
                        code: "compatibility_check_failed",
                        message: error.localizedDescription,
                        use: nil,
                        operation: nil,
                        resource: nil
                    )]
                )
            }
            isCheckingRuntime = false
        }
    }

    private func toggleCapability(_ capability: AgentCapability, _ isEnabled: Bool) {
        if isEnabled && !capability.envReady && !capability.requiredEnv.isEmpty {
            connectTarget = AgentSettingsConnectTarget(capability: capability)
            return
        }
        draft.setCapability(capability.id, enabled: isEnabled)
        errorMessage = nil
        saveFeedback = nil
    }

    private func save() {
        guard AgentSettingsSelectionPolicy.canSaveDraft(
            seededAgentId: draft.sourceAgentId.isEmpty ? nil : draft.sourceAgentId,
            targetAgentId: agentId
        ) else {
            errorMessage = "This editor belongs to another agent. Close it and try again."
            return
        }
        guard displayedAgent != nil else {
            finish()
            return
        }
        let patch = draft.patch
        guard !patch.isEmpty else {
            if isEmbedded {
                saveFeedback = .noChanges
                errorMessage = nil
            } else {
                finish()
            }
            return
        }

        isSaving = true
        Task {
            if patch.hasAgentFileChanges {
                let outcome = await monitor.updateAgent(id: agentId, settingsPatch: patch)
                switch outcome {
                case .success:
                    break
                case .deleted:
                    isSaving = false
                    errorMessage = "The agent was deleted before these changes could be saved."
                    return
                case .missingEnv(let keys):
                    isSaving = false
                    errorMessage = "Missing connection keys: \(keys.joined(separator: ", "))"
                    return
                case .failure(let message):
                    isSaving = false
                    errorMessage = message
                    return
                }
            }
            do {
                if draft.hasRuntimeChanges {
                    _ = try await monitor.updateAgentRuntime(
                        id: agentId,
                        request: draft.runtime.assignmentRequest(
                            expectedRevision: authoritativeAgent?.runtimeRevision ?? 0
                        )
                    )
                }
                let updatedAgent = try await monitor.refreshAgent(id: agentId)
                isSaving = false
                if AgentSettingsSavePresentation.shouldDismissAfterSave(isEmbedded: isEmbedded) {
                    finish()
                } else {
                    authoritativeAgent = updatedAgent
                    draft = AgentSettingsDraft(snapshot: updatedAgent.settingsSnapshot)
                    errorMessage = nil
                    saveFeedback = .saved
                }
            } catch {
                isSaving = false
                errorMessage = error.localizedDescription
            }
        }
    }

    private func finish() {
        if !isEmbedded { isPresented = false }
        onFinished()
    }

    private func deleteAgent() {
        Task {
            switch await monitor.deleteAgent(id: agentId) {
            case .deleted:
                isPresented = false
                onDeleted()
            case .success, .missingEnv, .failure:
                errorMessage = "Could not delete the agent."
            }
        }
    }
}
