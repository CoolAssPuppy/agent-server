import SwiftUI
import AgentServerDesignSystem

typealias ModelDraft = AgentRuntimeDraft

extension AgentRuntimeDraft {
    init(agent: Agent) {
        self.init(
            executor: agent.executor,
            model: agent.model,
            providerEndpoint: agent.provider?.baseURL,
            providerKeyReference: agent.provider?.apiKey
        )
    }
}

/// Plain-language coding-agent picker. Kimi Code uses the installed runtime;
/// Kimi K3 and Custom show where their API key lives, keeping secrets out of
/// the agent file.
struct ModelField: View {
    @Binding var draft: ModelDraft
    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Picker("", selection: $draft.choice) {
                ForEach(AgentRuntimeChoice.allCases) { option in
                    Text(option.displayName).tag(option)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .controlSize(.small)
            .frame(width: 220, alignment: .leading)
            .accessibilityLabel("Coding agent")
            .accessibilityIdentifier("agent-settings-coding-agent")

            switch draft.choice {
            case .claudeCode, .codex, .kimiCode:
                EmptyView()
            case .kimiK3:
                hint("Uses \(KimiModelPreset.keyVariable) from Settings.")
            case .custom:
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    TextField("Endpoint URL, e.g. https://api.example.com/v1", text: $draft.customEndpoint)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11, design: .monospaced))
                    TextField("Model name, e.g. llama-3.1-70b", text: $draft.customModel)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11))
                    TextField("API key variable, e.g. MY_API_KEY", text: $draft.customKeyVariable)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11, design: .monospaced))
                    hint("The key value lives in Settings as this variable, not in the agent file.")
                }
            }
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(NTypography.captionSmall)
            .foregroundStyle(theme.tokens.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }
}
