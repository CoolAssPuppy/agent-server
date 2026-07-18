import SwiftUI
import NerdsUI

/// Consumer new-agent flow: a name, plain-language instructions, a schedule,
/// and capability checkboxes. The server turns this into a markdown agent
/// file with an explicit allowlist built from the chosen capabilities.
struct CreateAgentSheet: View {
    @ObservedObject var monitor: StatusMonitor
    @Binding var isPresented: Bool
    /// Called with the new agent's id after a successful create.
    var onCreated: (String) -> Void = { _ in }

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var name = ""
    @State private var descriptionText = ""
    @State private var promptText = ""
    @State private var scheduleDraft = ScheduleDraft()
    @State private var catalog: [CapabilityCatalogEntry] = []
    @State private var selectedCapabilityIds: Set<String> = ["read-files"]
    @State private var creating = false
    @State private var errorMessage: String?
    /// Drives the staggered entrance of the capability rows once loaded.
    @State private var rowsVisible = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.lg) {
                    basicsCard
                    instructionsCard
                    capabilitiesCard
                }
                .padding(NSpacing.xl)
            }
            footerBar
        }
        .frame(width: 600, height: 720)
        .background(theme.tokens.background)
        .task {
            catalog = await monitor.capabilityCatalog()
            // Reveal the rows once, staggered. Reduced motion shows them at rest.
            if reduceMotion {
                rowsVisible = true
            } else {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) {
                    rowsVisible = true
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text("New agent")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text("Give it a name, tell it what to do, and pick what it's allowed to touch.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, NSpacing.xl)
        .padding(.top, NSpacing.lg)
        .padding(.bottom, NSpacing.md)
    }

    // MARK: - Basics

    private var basicsCard: some View {
        FormCard(title: "Basics") {
            LabeledField(label: "Name") {
                TextField("e.g. Morning Briefing", text: $name)
                    .textFieldStyle(.roundedBorder)
            }
            LabeledField(label: "Description", hint: "Optional") {
                TextField("One line about what it does", text: $descriptionText)
                    .textFieldStyle(.roundedBorder)
            }
            LabeledField(label: "When should it run?") {
                ScheduleField(draft: $scheduleDraft)
            }
        }
    }

    // MARK: - Instructions

    private var instructionsCard: some View {
        FormCard(title: "Instructions") {
            Text("Write what this agent should do, in plain language.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            MarkdownEditor(text: $promptText)
                .frame(height: 150)
                .padding(NSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.background)
                        .overlay(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .strokeBorder(theme.tokens.border, lineWidth: 1)
                        )
                )
        }
    }

    // MARK: - Capabilities

    private var capabilitiesCard: some View {
        FormCard(title: "What it can do") {
            Text("Turn on only what this agent needs. You can change this later.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)

            if catalog.isEmpty {
                HStack(spacing: NSpacing.sm) {
                    ProgressView().controlSize(.small)
                    Text("Loading capabilities…")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, NSpacing.sm)
            } else {
                VStack(spacing: NSpacing.xs) {
                    ForEach(Array(catalog.enumerated()), id: \.element.id) { index, entry in
                        CapabilityPickRow(
                            entry: entry,
                            isSelected: selectedCapabilityIds.contains(entry.id),
                            onToggle: { toggle(entry) }
                        )
                        // Staggered reveal: each row eases up and in slightly
                        // after the one above it. Motion points in the settling
                        // direction rather than a uniform fade.
                        .opacity(rowsVisible ? 1 : 0)
                        .offset(y: rowsVisible ? 0 : 10)
                        .animation(
                            reduceMotion
                                ? .none
                                : .spring(response: 0.45, dampingFraction: 0.9)
                                    .delay(Double(index) * 0.035),
                            value: rowsVisible
                        )
                    }
                }
                .padding(.top, NSpacing.xxs)
            }
        }
    }

    private func toggle(_ entry: CapabilityCatalogEntry) {
        // Capabilities that still need a connection can't be switched on here;
        // the agent's gear editor runs the Connect flow after creation.
        if !entry.envReady && !entry.requiredEnv.isEmpty { return }
        if selectedCapabilityIds.contains(entry.id) {
            selectedCapabilityIds.remove(entry.id)
        } else {
            selectedCapabilityIds.insert(entry.id)
        }
    }

    // MARK: - Footer

    private var footerBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)
            HStack(spacing: NSpacing.sm) {
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.error)
                        .lineLimit(2)
                }
                Spacer()
                Button("Cancel") { isPresented = false }
                    .controlSize(.large)
                    .keyboardShortcut(.cancelAction)
                Button {
                    create()
                } label: {
                    Group {
                        if creating {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Create agent")
                        }
                    }
                    .frame(minWidth: 92)
                }
                .controlSize(.large)
                .buttonStyle(.borderedProminent)
                .tint(theme.tokens.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(creating || !canCreate)
            }
            .padding(.horizontal, NSpacing.xl)
            .padding(.vertical, NSpacing.md)
        }
    }

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func create() {
        creating = true
        errorMessage = nil
        // Send every catalog capability explicitly so unchecked ones are
        // recorded as off — the server builds a tight allowlist from this.
        let capabilities = catalog.map { entry in
            (id: entry.id, enabled: selectedCapabilityIds.contains(entry.id))
        }
        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespaces)

        Task {
            let result = await monitor.createAgent(
                name: name.trimmingCharacters(in: .whitespaces),
                description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                prompt: promptText,
                schedule: scheduleDraft.cronExpression,
                capabilities: capabilities
            )
            creating = false
            switch result {
            case .success(let agent):
                isPresented = false
                onCreated(agent.id)
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Capability pick row

/// A tap-anywhere capability row for the new-agent flow: a tinted icon chip,
/// label + description, and a trailing checkmark. Connection capabilities that
/// aren't set up yet are shown muted with a "Connect later" tag.
private struct CapabilityPickRow: View {
    let entry: CapabilityCatalogEntry
    let isSelected: Bool
    let onToggle: () -> Void

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var needsConnection: Bool {
        !entry.envReady && !entry.requiredEnv.isEmpty
    }

    /// Plain-language note about how this connection is set up, so a
    /// non-technical person knows what to expect before they turn it on.
    private var connectionHint: String? {
        guard needsConnection else { return nil }
        switch entry.auth {
        case .oauth: return "Sign in on first use"
        default: return "Connect later"
        }
    }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: NSpacing.md) {
                iconChip
                VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                    HStack(spacing: NSpacing.xs) {
                        Text(entry.label)
                            .font(NTypography.bodyMedium)
                            .foregroundStyle(theme.tokens.foreground)
                        if let connectionHint {
                            Text(connectionHint)
                                .font(NTypography.badge)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .padding(.horizontal, NSpacing.xs)
                                .padding(.vertical, 1)
                                .background(theme.tokens.muted)
                                .clipShape(Capsule())
                        }
                    }
                    Text(entry.description)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                }
                Spacer(minLength: NSpacing.sm)
                selectionIndicator
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .fill(isSelected ? theme.tokens.primary.opacity(0.10) : theme.tokens.background)
            )
            .overlay(
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .strokeBorder(
                        isSelected ? theme.tokens.primary.opacity(0.45) : theme.tokens.border,
                        lineWidth: 1
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .opacity(needsConnection ? 0.6 : 1)
        // Selection state settles with a spring so the tint, border, chip, and
        // checkmark move together rather than snapping.
        .springOr(reduceMotion: reduceMotion, response: 0.3, damping: 0.85, value: isSelected)
    }

    private var iconChip: some View {
        Image(systemName: entry.icon)
            .font(.system(size: NIconSize.xs, weight: .semibold))
            .foregroundStyle(isSelected ? theme.tokens.primary : theme.tokens.mutedForeground)
            .frame(width: 30, height: 30)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(isSelected ? theme.tokens.primary.opacity(0.14) : theme.tokens.muted)
            )
    }

    @ViewBuilder
    private var selectionIndicator: some View {
        if needsConnection {
            Image(systemName: entry.auth == .oauth ? "person.badge.key.fill" : "lock.fill")
                .font(.system(size: NIconSize.xs))
                .foregroundStyle(theme.tokens.mutedForeground)
        } else {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: NIconSize.sm))
                .foregroundStyle(isSelected ? theme.tokens.primary : theme.tokens.border)
                // Circle <-> checkmark swaps as one glyph morphing, not a
                // hard image cut.
                .contentTransition(.symbolEffect(.replace))
        }
    }
}

// MARK: - Layout helpers

/// A titled container matching the app's settings cards: uppercase tracked
/// header, card fill, hairline border, medium radius.
private struct FormCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(theme.tokens.mutedForeground)
            content()
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}

/// A field label (with optional muted hint) stacked over its control.
private struct LabeledField<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder let content: () -> Content

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack(spacing: NSpacing.xs) {
                Text(label)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.foreground)
                if let hint {
                    Text(hint)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            content()
        }
    }
}
