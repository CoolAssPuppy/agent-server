import SwiftUI
import AgentServerDesignSystem

/// Pairing this Mac with Agent Panel.
///
/// Until this exists, Panel can only be reached with an organization API key,
/// which does not say which machine is speaking. Panel could therefore never
/// address a job to one Mac rather than another, and its own pairing screen
/// handed out codes that nothing here could redeem.
///
/// The code goes to the daemon and the credential stays there. This app never
/// holds one, so there is nothing here to store or to leak.
struct SettingsPairingSection: View {
    @ObservedObject var monitor: StatusMonitor
    @Environment(\.nTheme) private var theme

    @State private var code = ""
    @State private var isPairing = false
    @State private var message: String?
    @State private var didPair = false

    var body: some View {
        SettingsGroup(title: SettingsSection.pairing.title) {
            Text("Panel shows an eight character code under Settings, Devices. Enter it here and this Mac appears there by name.")
                .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 8)

            HStack(spacing: 8) {
                TextField("ABCD EFGH", text: $code)
                    .pairingFieldStyle(theme: theme)
                    .disabled(isPairing)
                    .accessibilityIdentifier("settings.pairingCode")
                    .onSubmit { pair() }

                Button(isPairing ? "Pairing…" : "Pair") {
                    pair()
                }
                .disabled(isPairing || code.trimmingCharacters(in: .whitespaces).count < 6)
                .accessibilityIdentifier("settings.pairButton")
            }

            if let message {
                Text(message)
                    .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                    // Green for the one outcome worth celebrating, and the
                    // theme's own warning colour for everything else.
                    .foregroundStyle(didPair ? theme.tokens.success : theme.tokens.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
        }
    }

    private func pair() {
        let entered = code.trimmingCharacters(in: .whitespaces)
        guard !entered.isEmpty else { return }

        isPairing = true
        message = nil

        Task {
            do {
                let name = try await monitor.client.pairWithPanel(code: entered)
                await MainActor.run {
                    didPair = true
                    message = "Paired as \"\(name)\". Restart Agent Server to start using it."
                    code = ""
                    isPairing = false
                }
            } catch {
                await MainActor.run {
                    didPair = false
                    message = error.localizedDescription
                    isPairing = false
                }
            }
        }
    }
}

private extension View {
    /// The same treatment every other field in the app gets.
    ///
    /// A field that sets no foreground colour draws its text in the system
    /// default, which under this app's dark theme is dark on dark. The code
    /// was going in and rendering as an empty box.
    func pairingFieldStyle(theme: ThemeConfiguration) -> some View {
        self
            .textFieldStyle(.plain)
            .font(.system(size: 13, design: .monospaced))
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(theme.tokens.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
            )
    }
}
