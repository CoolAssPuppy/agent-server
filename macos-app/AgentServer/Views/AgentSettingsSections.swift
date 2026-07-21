import AgentServerDesignSystem
import SwiftUI

struct AgentSettingsForm: View {
    let agent: Agent?
    let agentId: String
    @Binding var draft: AgentSettingsDraft
    let onToggleCapability: (AgentCapability, Bool) -> Void
    let onDelete: () -> Void
    @Environment(\.nTheme) private var theme

    var body: some View {
        Form {
            Section("Basics") {
                TextField("Name", text: $draft.name, prompt: Text("Agent name"))
                descriptionField
                LabeledContent("Schedule") { ScheduleField(draft: $draft.schedule) }
            }
            Section("AI model") { ModelField(draft: $draft.runtime) }
            instructionsSection
            capabilitiesSection
            AgentSettingsDeleteSection(name: agent?.name ?? agentId, onDelete: onDelete)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text("Description")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            TextField("What does this agent do?", text: $draft.descriptionText, axis: .vertical)
                .labelsHidden()
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Description")
                .accessibilityIdentifier("agent-settings-description")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var instructionsSection: some View {
        Section {
            MarkdownEditor(text: $draft.promptText)
                .frame(height: 180)
                .padding(NSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .strokeBorder(theme.tokens.border, lineWidth: 1)
                        )
                )
        } header: {
            HStack {
                Text("Instructions")
                Spacer()
                if let fileURL = AgentFile.find(agentId: agentId)?.url {
                    Button("Open raw file") { NSWorkspace.shared.open(fileURL) }
                        .buttonStyle(.link)
                        .accessibilityIdentifier("agent-settings-open-raw-file")
                }
            }
        }
    }

    private var capabilitiesSection: some View {
        Section("What this agent can do") {
            let capabilities = agent?.capabilities ?? []
            if capabilities.isEmpty {
                Text("Capabilities are unavailable. Update and restart Agent Server.")
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                ForEach(capabilities, id: \.id) { capability in
                    AgentSettingsCapabilityRow(
                        capability: capability,
                        isEnabled: draft.isCapabilityEnabled(capability.id, fallback: capability.enabled),
                        onToggle: { onToggleCapability(capability, $0) }
                    )
                }
            }
        }
    }
}

private struct AgentSettingsDeleteSection: View {
    let name: String
    let onDelete: () -> Void
    @State private var isConfirming = false

    var body: some View {
        Section {
            Button(role: .destructive) { isConfirming = true } label: {
                Label("Delete agent", systemImage: "trash").font(NTypography.caption)
            }
            .confirmationDialog("Delete \(name)?", isPresented: $isConfirming) {
                Button("Delete", role: .destructive, action: onDelete)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The agent's file is moved aside, not destroyed. You can recover it from the .deleted folder inside your agents folder.")
            }
        }
    }
}
