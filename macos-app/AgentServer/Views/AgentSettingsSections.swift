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
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                basicsCard
                AgentSettingsCard(title: "AI model") {
                    ModelField(draft: $draft.runtime)
                }
                instructionsCard
                capabilitiesCard
                AgentSettingsDeleteAction(name: agent?.name ?? agentId, onDelete: onDelete)
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var basicsCard: some View {
        AgentSettingsCard(title: "Basics") {
            agentField("Name") {
                TextField("Agent name", text: $draft.name)
                    .multilineTextAlignment(.leading)
                    .agentSettingsInputChrome()
            }
            AgentSettingsRowDivider().padding(.vertical, 10)
            agentField("Description") {
                TextField("What does this assistant do?", text: $draft.descriptionText, axis: .vertical)
                    .lineLimit(3...6)
                    .accessibilityLabel("Description")
                    .accessibilityIdentifier("agent-settings-description")
                    .agentSettingsInputChrome()
            }
            AgentSettingsRowDivider().padding(.vertical, 10)
            HStack(alignment: .top, spacing: 12) {
                Text("Schedule")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.tokens.foreground)
                    .frame(width: 84, alignment: .leading)
                ScheduleField(draft: $draft.schedule)
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func agentField<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.tokens.foreground)
            content()
        }
    }

    private var instructionsCard: some View {
        AgentSettingsCard(
            title: "Instructions",
            actionLabel: AgentFile.find(agentId: agentId) == nil ? nil : "Open raw file",
            action: openRawAgentFile
        ) {
            MarkdownEditor(text: $draft.promptText)
                .frame(height: 180)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(theme.tokens.muted)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(theme.tokens.border, lineWidth: 1)
                        )
                )
        }
    }

    private var capabilitiesCard: some View {
        let capabilities = agent?.capabilities ?? []
        return AgentSettingsCard(title: "What this assistant can do") {
            if capabilities.isEmpty {
                Text("Capabilities are unavailable. Update and restart Agent Server.")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                ForEach(Array(capabilities.enumerated()), id: \.element.id) { index, capability in
                    AgentSettingsCapabilityRow(
                        capability: capability,
                        isEnabled: draft.isCapabilityEnabled(capability.id, fallback: capability.enabled),
                        onToggle: { onToggleCapability(capability, $0) },
                        isCompact: true
                    )
                    if index < capabilities.count - 1 {
                        AgentSettingsRowDivider().padding(.vertical, 4)
                    }
                }
            }
        }
    }

    private func openRawAgentFile() {
        guard let fileURL = AgentFile.find(agentId: agentId)?.url else { return }
        NSWorkspace.shared.open(fileURL)
    }
}

private struct AgentSettingsCard<Content: View>: View {
    let title: String
    var actionLabel: String?
    var action: (() -> Void)?
    @ViewBuilder let content: () -> Content
    @Environment(\.nTheme) private var theme

    init(
        title: String,
        actionLabel: String? = nil,
        action: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.actionLabel = actionLabel
        self.action = action
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer(minLength: 0)
                if let actionLabel, let action {
                    Button(actionLabel, action: action)
                        .font(.system(size: 11, weight: .medium))
                        .buttonStyle(.plain)
                        .foregroundStyle(theme.tokens.primary)
                        .accessibilityIdentifier("agent-settings-open-raw-file")
                }
            }
            .padding(.bottom, 12)
            content()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(theme.tokens.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(theme.tokens.border, lineWidth: 1)
        )
    }
}

private struct AgentSettingsRowDivider: View {
    @Environment(\.nTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.tokens.border.opacity(0.65))
            .frame(height: 1)
    }
}

private struct AgentSettingsDeleteAction: View {
    let name: String
    let onDelete: () -> Void
    @State private var isConfirming = false
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack {
            Spacer()
            Button(role: .destructive) { isConfirming = true } label: {
                Label("Delete agent", systemImage: "trash")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(theme.tokens.destructive)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(theme.tokens.muted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(theme.tokens.destructive.opacity(0.35), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .confirmationDialog("Delete \(name)?", isPresented: $isConfirming) {
                Button("Delete", role: .destructive, action: onDelete)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The agent's file is moved aside, not destroyed. You can recover it from the .deleted folder inside your agents folder.")
            }
        }
    }
}

private extension View {
    func agentSettingsInputChrome() -> some View {
        modifier(AgentSettingsInputChrome())
    }
}

private struct AgentSettingsInputChrome: ViewModifier {
    @Environment(\.nTheme) private var theme

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.system(size: 11))
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(theme.tokens.muted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(theme.tokens.border, lineWidth: 1)
            )
    }
}
