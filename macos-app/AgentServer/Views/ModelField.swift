import SwiftUI
import NerdsUI

/// Editable state for an agent's model choice, mapping the plain-language
/// picker to the underlying `executor` / `model` / `provider` fields. Mirrors
/// `ScheduleDraft`: seed from an agent, edit through `ModelField`, then read the
/// resolved values back into a patch. The picker hides the plumbing — a
/// non-technical user picks "Kimi K2", not an OpenAI-compatible base URL.
struct ModelDraft: Equatable {
    enum Choice: String, CaseIterable, Identifiable {
        case claude = "Claude (your plan)"
        case codex = "Codex (your ChatGPT)"
        case kimi = "Kimi K2"
        case custom = "Custom…"
        var id: String { rawValue }
    }

    // Moonshot's OpenAI-compatible endpoint, used by the Kimi K2 preset.
    static let kimiEndpoint = "https://api.moonshot.ai/v1"
    static let kimiModel = "kimi-k2"
    static let kimiKeyVar = "MOONSHOT_API_KEY"

    var choice: Choice = .claude
    var customEndpoint = ""
    var customModel = ""
    var customKeyVar = ""

    init() {}

    /// Derive the current choice from an agent's stored fields.
    init(agent: Agent) {
        if let provider = agent.provider {
            if provider.baseURL == Self.kimiEndpoint && agent.model == Self.kimiModel {
                choice = .kimi
            } else {
                choice = .custom
                customEndpoint = provider.baseURL
                customModel = agent.model ?? ""
                customKeyVar = Self.variableName(from: provider.apiKey)
            }
        } else if agent.executor == "codex" {
            choice = .codex
        } else {
            choice = .claude
        }
    }

    // MARK: - Resolved fields (what a patch should persist)

    /// `nil` means remove the field (Claude is the default executor).
    var resolvedExecutor: String? {
        switch choice {
        case .claude: return nil
        case .codex, .kimi, .custom: return "codex"
        }
    }

    var resolvedModel: String? {
        switch choice {
        case .claude, .codex: return nil
        case .kimi: return Self.kimiModel
        case .custom:
            let trimmed = customModel.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    var resolvedProvider: ProviderConfig? {
        switch choice {
        case .claude, .codex:
            return nil
        case .kimi:
            return ProviderConfig(baseURL: Self.kimiEndpoint, apiKey: "${\(Self.kimiKeyVar)}")
        case .custom:
            let endpoint = customEndpoint.trimmingCharacters(in: .whitespaces)
            guard !endpoint.isEmpty else { return nil }
            let keyVar = customKeyVar.trimmingCharacters(in: .whitespaces)
            let apiKey = keyVar.isEmpty ? nil : "${\(keyVar)}"
            return ProviderConfig(baseURL: endpoint, apiKey: apiKey)
        }
    }

    /// Whether the current selection is complete enough to save.
    var isValid: Bool {
        guard choice == .custom else { return true }
        return !customEndpoint.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// The environment variable a custom/Kimi key resolves from, for the hint.
    var keyVariableHint: String? {
        switch choice {
        case .claude, .codex: return nil
        case .kimi: return Self.kimiKeyVar
        case .custom:
            let keyVar = customKeyVar.trimmingCharacters(in: .whitespaces)
            return keyVar.isEmpty ? nil : keyVar
        }
    }

    private static func variableName(from ref: String?) -> String {
        guard let ref else { return "" }
        if ref.hasPrefix("${") && ref.hasSuffix("}") {
            return String(ref.dropFirst(2).dropLast())
        }
        return ref
    }
}

/// Plain-language model picker. Custom reveals endpoint/model/key fields; Kimi
/// and Custom show where the key lives (`.env`), keeping secrets out of the
/// agent file.
struct ModelField: View {
    @Binding var draft: ModelDraft
    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Picker("", selection: $draft.choice) {
                ForEach(ModelDraft.Choice.allCases) { option in
                    Text(option.rawValue).tag(option)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(width: 220, alignment: .leading)

            switch draft.choice {
            case .claude:
                hint("Runs on your Claude subscription.")
            case .codex:
                hint("Runs on your ChatGPT (Codex) subscription.")
            case .kimi:
                hint("Runs on Kimi K2 via Moonshot. Add \(ModelDraft.kimiKeyVar) in Settings if you have not already.")
            case .custom:
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    TextField("Endpoint URL, e.g. https://api.example.com/v1", text: $draft.customEndpoint)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                    TextField("Model name, e.g. llama-3.1-70b", text: $draft.customModel)
                        .textFieldStyle(.roundedBorder)
                    TextField("API key variable, e.g. MY_API_KEY", text: $draft.customKeyVar)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
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
