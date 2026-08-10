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
    @State private var status: PairingStatus?

    var body: some View {
        SettingsGroup(title: SettingsSection.pairing.title) {
            // Read from the server every time this appears. The previous
            // version only ever said "paired" in a @State line written by the
            // pairing itself, so quitting the app -- or just leaving this
            // screen -- made a paired Mac look like it had never paired.
            if let status, let summary = PairingPresentation.summary(for: status) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary)
                        .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize), weight: .medium))
                        .foregroundStyle(status.inUse ? theme.tokens.success : theme.tokens.warning)
                        .fixedSize(horizontal: false, vertical: true)

                    if let detail = PairingPresentation.detail(for: status) {
                        Text(detail)
                            .font(.system(size: CGFloat(SettingsPresentation.supportingFontSize)))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
                .accessibilityIdentifier("settings.pairingStatus")
                .padding(.bottom, 8)
            }

            Text(status?.paired == true
                ? "Entering a new code from Panel pairs this Mac again and replaces the credential it holds."
                : "Panel shows an eight character code under Settings, Devices. Enter it here and this Mac appears there by name.")
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
        .task { await refreshStatus() }
    }

    /// A server that cannot answer leaves the section as it was. An unpaired
    /// Mac and an unreachable one both show the form, and inventing a
    /// "not paired" line for the second would be a guess.
    private func refreshStatus() async {
        guard let latest = try? await monitor.client.pairingStatus() else { return }
        await MainActor.run { status = latest }
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
                // The section above this now has something to say, and the
                // person is still looking at it.
                await refreshStatus()
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
