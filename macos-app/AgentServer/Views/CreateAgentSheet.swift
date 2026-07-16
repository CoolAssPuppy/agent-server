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

    @State private var name = ""
    @State private var descriptionText = ""
    @State private var promptText = ""
    @State private var scheduleDraft = ScheduleDraft()
    @State private var catalog: [CapabilityCatalogEntry] = []
    @State private var selectedCapabilityIds: Set<String> = ["read-files"]
    @State private var creating = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    basicsSection
                    instructionsSection
                    capabilitiesSection
                }
                .padding(NSpacing.xl)
            }
            Divider().opacity(0.3)
            footerBar
        }
        .frame(width: 560, height: 640)
        .background(theme.tokens.background)
        .task {
            catalog = await monitor.capabilityCatalog()
        }
    }

    private var header: some View {
        HStack {
            Text("New agent")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var basicsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("Name")
                TextField("e.g. Morning Briefing", text: $name)
                    .textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("Description (optional)")
                TextField("One line about what it does", text: $descriptionText)
                    .textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("When should it run?")
                ScheduleField(draft: $scheduleDraft)
            }
        }
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            fieldLabel("What should this agent do?")
            MarkdownEditor(text: $promptText)
                .frame(height: 160)
                .padding(NSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .strokeBorder(theme.tokens.border, lineWidth: 1)
                        )
                )
        }
    }

    private var capabilitiesSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            fieldLabel("What can it use?")
            VStack(spacing: 0) {
                ForEach(Array(catalog.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { Divider().opacity(0.3) }
                    catalogRow(entry)
                }
                if catalog.isEmpty {
                    Text("Loading capabilities…")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .padding(NSpacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(theme.tokens.card)
            .overlay(
                RoundedRectangle(cornerRadius: NRadius.sm)
                    .stroke(theme.tokens.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        }
    }

    private func catalogRow(_ entry: CapabilityCatalogEntry) -> some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: entry.icon)
                .font(.system(size: 13))
                .foregroundStyle(
                    selectedCapabilityIds.contains(entry.id)
                        ? theme.tokens.primary
                        : theme.tokens.mutedForeground
                )
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.label)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground)
                Text(entry.description)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
                if !entry.envReady && !entry.requiredEnv.isEmpty {
                    Text("Needs connecting after creation")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.primary)
                }
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { selectedCapabilityIds.contains(entry.id) },
                set: { isOn in
                    if isOn {
                        selectedCapabilityIds.insert(entry.id)
                    } else {
                        selectedCapabilityIds.remove(entry.id)
                    }
                }
            ))
            .toggleStyle(.switch)
            .controlSize(.mini)
            .labelsHidden()
            // Connection capabilities without keys are created disabled; the
            // Connect flow in the agent editor finishes the setup.
            .disabled(!entry.envReady && !entry.requiredEnv.isEmpty)
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.xs)
    }

    private var footerBar: some View {
        HStack(spacing: NSpacing.sm) {
            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
            Spacer()
            Button("Cancel") { isPresented = false }
                .keyboardShortcut(.cancelAction)
            Button {
                create()
            } label: {
                if creating {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Create agent")
                }
            }
            .keyboardShortcut(.defaultAction)
            .disabled(creating || !canCreate)
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
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

    private func fieldLabel(_ label: String) -> some View {
        Text(label)
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
    }
}
