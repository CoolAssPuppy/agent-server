import AppKit
import AgentServerDesignSystem
import SwiftUI

struct SlackPairingSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let initialStatus: SlackPairingStatus
    let onStatusChange: (SlackPairingStatus) -> Void
    let onEditCredentials: () -> Void
    let onDone: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var status: SlackPairingStatus
    @State private var channelID = ""
    @State private var isAdvancedExpanded = false
    @State private var isSaving = false
    @State private var isSendingTest = false
    @State private var hasOpenedSlack = false
    @State private var feedback: String?
    @State private var errorMessage: String?

    init(
        monitor: StatusMonitor,
        initialStatus: SlackPairingStatus,
        onStatusChange: @escaping (SlackPairingStatus) -> Void,
        onEditCredentials: @escaping () -> Void,
        onDone: @escaping () -> Void
    ) {
        self.monitor = monitor
        self.initialStatus = initialStatus
        self.onStatusChange = onStatusChange
        self.onEditCredentials = onEditCredentials
        self.onDone = onDone
        _status = State(initialValue: initialStatus)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            heading
            pairingContent
            advancedDestination
            feedbackContent
            footer
        }
        .padding(NSpacing.xl)
        .frame(width: 460)
        .background(theme.tokens.background)
        .task { await pollUntilReady() }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(status.state == .ready ? "Slack messaging" : "Finish Slack setup")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text(status.state == .ready
                 ? "Agent Server can send notifications and replies to your saved Slack conversation."
                 : "Open your bot’s Messages tab in Slack and send a short message. Agent Server will save that conversation as the destination for this Mac.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var pairingContent: some View {
        switch status.state {
        case .ready:
            Label("Slack is ready", systemImage: "checkmark.circle.fill")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.success)
        case .starting:
            HStack(spacing: NSpacing.sm) {
                ProgressView().controlSize(.small)
                Text("Starting Slack…")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        case .needsPairing:
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Button("Open bot in Slack", action: openSlack)
                    .buttonStyle(.borderedProminent)
                    .disabled(!status.canOpenSlack || status.openURL == nil)
                if hasOpenedSlack {
                    HStack(spacing: NSpacing.sm) {
                        ProgressView().controlSize(.small)
                        Text("Waiting for your message…")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
            }
        case .error:
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Text("Slack could not connect. Check the bot and app tokens, then try again.")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.destructive)
                Button("Check again") {
                    Task { apply(await monitor.slackPairingStatus()) }
                }
            }
        case .notConfigured:
            Text("Add the Slack bot and app tokens first.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
    }

    private var advancedDestination: some View {
        DisclosureGroup("Advanced", isExpanded: $isAdvancedExpanded) {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Text("Use a direct-message ID from another Agent Server setup, such as D0123456789.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                TextField("Slack conversation ID", text: $channelID)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(saveDestination)
                HStack {
                    Spacer()
                    Button("Save destination", action: saveDestination)
                        .disabled(isSaving || !SlackConversationID.isValid(channelID))
                }
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.bodyMedium)
    }

    @ViewBuilder
    private var feedbackContent: some View {
        if let feedback {
            Text(feedback)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.success)
        }
        if let errorMessage {
            Text(errorMessage)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.destructive)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack {
            Button("Edit credentials", action: onEditCredentials)
            if status.canOpenSlack, status.openURL != nil, status.state == .ready {
                Button("Open Slack", action: openSlack)
            }
            if status.canTest {
                Button("Send test message", action: sendTest)
                    .disabled(isSendingTest)
            }
            Spacer()
            Button("Done", action: onDone)
                .keyboardShortcut(.defaultAction)
        }
    }

    private func openSlack() {
        guard let url = status.openURL else { return }
        hasOpenedSlack = NSWorkspace.shared.open(url)
        errorMessage = hasOpenedSlack ? nil : "Slack could not be opened. Open Slack and message the bot directly."
    }

    private func saveDestination() {
        let normalized = SlackConversationID.normalized(channelID)
        guard SlackConversationID.isValid(normalized) else { return }
        isSaving = true
        feedback = nil
        errorMessage = nil
        Task {
            do {
                let updated = try await monitor.pairSlack(channelID: normalized)
                apply(updated)
                channelID = ""
                feedback = "Slack destination saved."
            } catch {
                errorMessage = "Could not save the Slack destination: \(error.localizedDescription)"
            }
            isSaving = false
        }
    }

    private func sendTest() {
        isSendingTest = true
        feedback = nil
        errorMessage = nil
        Task {
            do {
                try await monitor.testSlack()
                feedback = "Test message sent."
            } catch {
                errorMessage = "Could not send the test message: \(error.localizedDescription)"
            }
            isSendingTest = false
        }
    }

    private func pollUntilReady() async {
        while !Task.isCancelled, status.state != .ready {
            let updated = await monitor.slackPairingStatus()
            apply(updated)
            if updated.state == .ready { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    @MainActor
    private func apply(_ updated: SlackPairingStatus) {
        status = updated
        onStatusChange(updated)
    }
}
