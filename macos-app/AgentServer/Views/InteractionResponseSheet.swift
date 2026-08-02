import SwiftUI
import AgentServerDesignSystem

struct InteractionResponseSheet: View {
    let interaction: LocalInteraction
    let submit: (LocalInteractionReply) async throws -> InteractionReplyAcceptance
    let onAccepted: (InteractionReplyAcceptance) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.nTheme) private var theme
    @State private var draft: InteractionResponseDraft
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    init(
        interaction: LocalInteraction,
        submit: @escaping (LocalInteractionReply) async throws -> InteractionReplyAcceptance,
        onAccepted: @escaping (InteractionReplyAcceptance) -> Void
    ) {
        self.interaction = interaction
        self.submit = submit
        self.onAccepted = onAccepted
        _draft = State(
            initialValue: InteractionResponseDraft(
                allowsFreeText: interaction.allowsFreeText
            )
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
            Divider().opacity(0.3)
            footer
        }
        .frame(width: 520)
        .background(theme.tokens.background)
        .interactiveDismissDisabled(isSubmitting)
        .accessibilityIdentifier("interaction.responseSheet")
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    Text(interaction.options.isEmpty ? "Reply to the agent" : "Choose what happens next")
                        .font(NTypography.headlineLarge)
                        .foregroundStyle(theme.tokens.foreground)
                    Text(interaction.message)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !interaction.options.isEmpty {
                    VStack(spacing: NSpacing.sm) {
                        ForEach(interaction.options, id: \.index) { option in
                            optionButton(option)
                        }
                    }
                }

                if interaction.allowsFreeText {
                    VStack(alignment: .leading, spacing: NSpacing.xs) {
                        Text(interaction.options.isEmpty ? "Your answer" : "Or write an answer")
                            .font(NTypography.labelMedium)
                            .foregroundStyle(theme.tokens.foreground)
                        TextEditor(text: Binding(
                            get: { draft.text },
                            set: { draft.setText($0) }
                        ))
                        .font(NTypography.bodyMedium)
                        .scrollContentBackground(.hidden)
                        .padding(NSpacing.sm)
                        .frame(minHeight: 88)
                        .background(theme.tokens.card)
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
                        .overlay(
                            RoundedRectangle(cornerRadius: NRadius.md)
                                .stroke(theme.tokens.border, lineWidth: 1)
                        )
                        .accessibilityLabel("Your answer")
                        .accessibilityIdentifier("interaction.freeText")
                    }
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.error)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text("Respond by \(interaction.expiresAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .padding(NSpacing.xl)
        }
    }

    private func optionButton(_ option: LocalInteractionOption) -> some View {
        let isSelected = draft.selectedOptionIndex == option.index
        return Button {
            draft.selectOption(index: option.index)
        } label: {
            HStack(alignment: .top, spacing: NSpacing.md) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? theme.tokens.primary : theme.tokens.mutedForeground)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text(option.label)
                        .font(NTypography.bodyMedium)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.tokens.foreground)
                    if let description = option.description {
                        Text(description)
                            .font(NTypography.bodySmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
            }
            .padding(NSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? theme.tokens.primary.opacity(0.10) : theme.tokens.card)
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: NRadius.md)
                    .stroke(
                        isSelected ? theme.tokens.primary : theme.tokens.border,
                        lineWidth: 1
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("interaction.option.\(option.index)")
    }

    private var footer: some View {
        HStack(spacing: NSpacing.sm) {
            Button("Cancel") { dismiss() }
                .disabled(isSubmitting)
            Spacer()
            Button {
                submitResponse()
            } label: {
                if isSubmitting {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text("Send response")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!draft.canSubmit || isSubmitting)
            .accessibilityIdentifier("interaction.submit")
        }
        .padding(NSpacing.lg)
    }

    private func submitResponse() {
        guard let reply = draft.reply else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let acceptance = try await submit(reply)
                onAccepted(acceptance)
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
