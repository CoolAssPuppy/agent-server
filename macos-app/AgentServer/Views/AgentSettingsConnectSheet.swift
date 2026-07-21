import AgentServerDesignSystem
import SwiftUI

struct AgentSettingsConnectTarget: Identifiable {
    let capability: AgentCapability
    let missingKeys: [String]
    var id: String { capability.id }
}

struct AgentSettingsConnectSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let target: AgentSettingsConnectTarget
    let onDone: (Bool) -> Void

    @Environment(\.nTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var isBusy = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("Connect \(target.capability.label)")
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text("These keys are stored privately in your Agent Server folder, never inside agent files.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            fields
            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.error)
                    .lineLimit(3)
            }
            HStack {
                Spacer()
                Button("Cancel") { onDone(false) }.keyboardShortcut(.cancelAction)
                Button(action: connect) {
                    if isBusy { ProgressView().controlSize(.small) }
                    else { Text("Connect") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isBusy || !areAllFieldsFilled)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 420)
        .background(theme.tokens.background)
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            ForEach(target.missingKeys, id: \.self) { key in
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text(key)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    if EnvFileStore.isSecretKey(key) {
                        SecureField("Paste value", text: binding(for: key)).textFieldStyle(.roundedBorder)
                    } else {
                        TextField(key.hasSuffix("_URL") ? "https://…" : "Value", text: binding(for: key))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
    }

    private var areAllFieldsFilled: Bool {
        target.missingKeys.allSatisfy { !(values[$0] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func binding(for key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    private func connect() {
        isBusy = true
        errorMessage = nil
        Task {
            do {
                let trimmed = Dictionary(uniqueKeysWithValues: target.missingKeys.map {
                    ($0, (values[$0] ?? "").trimmingCharacters(in: .whitespaces))
                })
                try monitor.saveConnectionKeys(trimmed)
                isBusy = false
                onDone(true)
            } catch {
                isBusy = false
                errorMessage = "Could not save keys: \(error.localizedDescription)"
            }
        }
    }
}
