import SwiftUI
import NerdsUI

/// Consumer-facing agent editor presented from the gear button in the agent
/// detail drawer. Basics (name, description, schedule), the agent's
/// instructions, and a capability toggle list all persist through the
/// server's write API, which edits the underlying markdown/YAML file
/// losslessly. A collapsed Advanced section keeps the raw editor available
/// for power users.
struct AgentSettingsSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let agentId: String
    @Binding var isPresented: Bool
    /// Called after a successful delete so the presenting drawer can close.
    var onDeleted: () -> Void = {}

    @Environment(\.nTheme) private var theme

    @State private var didSeed = false
    @State private var name = ""
    @State private var descriptionText = ""
    @State private var promptText = ""
    @State private var enabled = true
    @State private var scheduleDraft = ScheduleDraft()
    @State private var modelDraft = ModelDraft()

    @State private var saving = false
    @State private var errorMessage: String?
    @State private var pendingCapabilityIds: Set<String> = []
    @State private var connectTarget: ConnectTarget?
    @State private var showAdvanced = false
    @State private var confirmingDelete = false

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    basicsSection
                    modelSection
                    instructionsSection
                    capabilitiesSection
                    advancedSection
                    deleteSection
                }
                .padding(NSpacing.xl)
            }
            Divider().opacity(0.3)
            footerBar
        }
        .frame(width: 640, height: 720)
        .background(theme.tokens.background)
        .onAppear(perform: seedIfNeeded)
        .sheet(item: $connectTarget) { target in
            ConnectCapabilitySheet(
                monitor: monitor,
                agentId: agentId,
                target: target,
                onDone: { connectTarget = nil }
            )
        }
    }

    private func seedIfNeeded() {
        guard !didSeed, let agent else { return }
        didSeed = true
        name = agent.name
        descriptionText = agent.description ?? ""
        promptText = agent.prompt
        enabled = agent.enabled
        scheduleDraft = ScheduleDraft(cron: agent.schedule)
        modelDraft = ModelDraft(agent: agent)
    }

    // MARK: - Header / footer

    private var header: some View {
        HStack(spacing: NSpacing.sm) {
            Text("Edit agent")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Spacer()
            Toggle(isOn: $enabled) {
                Text("Enabled")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .toggleStyle(.switch)
            .controlSize(.small)
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
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
                save()
            } label: {
                if saving {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Save")
                }
            }
            .keyboardShortcut(.defaultAction)
            .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || !modelDraft.isValid)
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    // MARK: - Basics

    private var basicsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            sectionTitle("Basics")

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("Name")
                TextField("Agent name", text: $name)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("Description")
                TextField("What does this agent do?", text: $descriptionText)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                fieldLabel("Schedule")
                ScheduleField(draft: $scheduleDraft)
            }
        }
    }

    // MARK: - Model

    private var modelSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            sectionTitle("Model")
            Text("Which AI runs this agent.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            ModelField(draft: $modelDraft)
        }
    }

    // MARK: - Instructions

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            sectionTitle("Instructions")
            Text("Tell the agent what to do in plain language.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            MarkdownEditor(text: $promptText)
                .frame(height: 180)
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

    // MARK: - Capabilities

    private var capabilitiesSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            sectionTitle("What this agent can do")
            Text("Changes apply immediately and are saved into the agent's file.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)

            VStack(spacing: 0) {
                let capabilities = agent?.capabilities ?? []
                if capabilities.isEmpty {
                    Text("Capabilities are unavailable — update and restart the agent server.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .padding(NSpacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(Array(capabilities.enumerated()), id: \.element.id) { index, capability in
                        if index > 0 { Divider().opacity(0.3) }
                        CapabilityRow(
                            capability: capability,
                            isBusy: pendingCapabilityIds.contains(capability.id),
                            onToggle: { newValue in
                                toggleCapability(capability, to: newValue)
                            }
                        )
                    }
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

    private func toggleCapability(_ capability: AgentCapability, to newValue: Bool) {
        // Connection capabilities that aren't set up yet go straight to the
        // Connect flow — the server would reject the toggle anyway.
        if newValue && !capability.envReady && !capability.requiredEnv.isEmpty {
            connectTarget = ConnectTarget(capability: capability, missingKeys: capability.requiredEnv)
            return
        }

        pendingCapabilityIds.insert(capability.id)
        Task {
            let outcome = await monitor.setCapability(
                agentId: agentId,
                capabilityId: capability.id,
                enabled: newValue
            )
            pendingCapabilityIds.remove(capability.id)
            switch outcome {
            case .success:
                errorMessage = nil
            case .missingEnv(let keys):
                connectTarget = ConnectTarget(capability: capability, missingKeys: keys)
            case .failure(let message):
                errorMessage = message
            }
        }
    }

    // MARK: - Advanced

    private var advancedSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { showAdvanced.toggle() }
            } label: {
                HStack(spacing: NSpacing.xs) {
                    Image(systemName: showAdvanced ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Advanced")
                        .font(NTypography.labelMedium)
                }
                .foregroundStyle(theme.tokens.mutedForeground)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if showAdvanced {
                if let fileURL = AgentFile.find(agentId: agentId)?.url {
                    Text("Raw agent file (\(fileURL.lastPathComponent)). Edits here bypass the fields above.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    AgentPromptEditor(fileURL: fileURL, onDefinitionChanged: monitor.poll)
                        .id(fileURL)
                        .frame(height: 300)
                } else {
                    Text("Could not locate the agent's file on disk.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
        }
    }

    // MARK: - Delete

    private var deleteSection: some View {
        HStack {
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("Delete agent", systemImage: "trash")
                    .font(NTypography.caption)
            }
            .confirmationDialog(
                "Delete \(agent?.name ?? agentId)?",
                isPresented: $confirmingDelete
            ) {
                Button("Delete", role: .destructive) { deleteAgent() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The agent's file is moved aside, not destroyed. You can recover it from ~/.agent-server/agents/.deleted.")
            }
            Spacer()
        }
    }

    private func deleteAgent() {
        Task {
            let outcome = await monitor.deleteAgent(id: agentId)
            switch outcome {
            case .success:
                isPresented = false
                onDeleted()
            case .missingEnv, .failure:
                errorMessage = "Could not delete the agent."
            }
        }
    }

    // MARK: - Save

    private func save() {
        guard let agent else {
            isPresented = false
            return
        }
        let patch = buildPatch(for: agent)
        guard !patch.isEmpty else {
            isPresented = false
            return
        }

        saving = true
        Task {
            let outcome = await monitor.updateAgent(id: agentId, patch: patch)
            saving = false
            switch outcome {
            case .success:
                isPresented = false
            case .missingEnv(let keys):
                errorMessage = "Missing connection keys: \(keys.joined(separator: ", "))"
            case .failure(let message):
                errorMessage = message
            }
        }
    }

    private func buildPatch(for agent: Agent) -> [String: Any] {
        var patch: [String: Any] = [:]

        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        if !trimmedName.isEmpty, trimmedName != agent.name {
            patch["name"] = trimmedName
        }

        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespaces)
        if trimmedDescription != (agent.description ?? "") {
            patch["description"] = trimmedDescription.isEmpty ? NSNull() : trimmedDescription
        }

        let cron = scheduleDraft.cronExpression
        if cron != agent.schedule {
            patch["schedule"] = cron ?? NSNull()
        }

        let trimmedPrompt = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPrompt.isEmpty, trimmedPrompt != agent.prompt {
            patch["prompt"] = promptText
        }

        if enabled != agent.enabled {
            patch["enabled"] = enabled
        }

        addModelChanges(to: &patch, for: agent)

        return patch
    }

    /// Translate the model picker into executor/model/provider patch keys, but
    /// only when the resolved selection differs from what the agent already has.
    /// `NSNull()` removes a field (e.g. switching back to the default plan drops
    /// the provider block entirely).
    private func addModelChanges(to patch: inout [String: Any], for agent: Agent) {
        guard modelDraft.isValid else { return }

        let currentExecutor = agent.executor
        // Treat the implicit default the same as an explicit one so picking
        // "Claude (your plan)" on an already-default agent is a no-op.
        let resolvedExecutor = modelDraft.resolvedExecutor
        if resolvedExecutor != currentExecutor {
            patch["executor"] = resolvedExecutor ?? NSNull()
        }

        if modelDraft.resolvedModel != agent.model {
            patch["model"] = modelDraft.resolvedModel ?? NSNull()
        }

        if modelDraft.resolvedProvider != agent.provider {
            if let provider = modelDraft.resolvedProvider {
                var providerDict: [String: Any] = ["base_url": provider.baseURL]
                if let apiKey = provider.apiKey { providerDict["api_key"] = apiKey }
                patch["provider"] = providerDict
            } else {
                patch["provider"] = NSNull()
            }
        }
    }

    // MARK: - Small helpers

    private func sectionTitle(_ title: String) -> some View {
        Text(title.uppercased())
            .font(NTypography.labelSmall)
            .foregroundStyle(theme.tokens.mutedForeground)
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label)
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
    }
}

// MARK: - Capability row

struct CapabilityRow: View {
    let capability: AgentCapability
    let isBusy: Bool
    let onToggle: (Bool) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: capability.icon)
                .font(.system(size: 14))
                .foregroundStyle(capability.enabled ? theme.tokens.primary : theme.tokens.mutedForeground)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: NSpacing.xs) {
                    Text(capability.label)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    if capability.custom {
                        Text("Custom")
                            .font(NTypography.badge)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .padding(.horizontal, NSpacing.xs)
                            .padding(.vertical, 1)
                            .background(theme.tokens.muted)
                            .clipShape(Capsule())
                    }
                }
                Text(capability.description)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(2)
                if needsConnection {
                    Text("Needs to be connected first")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.primary)
                }
            }

            Spacer()

            if isBusy {
                ProgressView().controlSize(.small)
            } else if needsConnection && !capability.enabled {
                Button("Connect…") { onToggle(true) }
                    .buttonStyle(.borderless)
                    .font(NTypography.caption)
            } else {
                Toggle("", isOn: Binding(
                    get: { capability.enabled },
                    set: { onToggle($0) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .labelsHidden()
            }
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.sm)
    }

    private var needsConnection: Bool {
        !capability.envReady && !capability.requiredEnv.isEmpty
    }
}

// MARK: - Connect flow

struct ConnectTarget: Identifiable {
    let capability: AgentCapability
    let missingKeys: [String]
    var id: String { capability.id }
}

/// Collects the values for a connection capability's env vars, saves them to
/// ~/.agent-server/.env, and retries the enable. Values never land in agent
/// files — those keep ${VAR} references.
struct ConnectCapabilitySheet: View {
    @ObservedObject var monitor: StatusMonitor
    let agentId: String
    let target: ConnectTarget
    let onDone: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var values: [String: String] = [:]
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("Connect \(target.capability.label)")
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text("These keys are stored privately in ~/.agent-server/.env — never inside agent files.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: NSpacing.sm) {
                ForEach(target.missingKeys, id: \.self) { key in
                    VStack(alignment: .leading, spacing: NSpacing.xxs) {
                        Text(key)
                            .font(NTypography.captionSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                        if EnvFileStore.isSecretKey(key) {
                            SecureField("Paste value", text: bindingFor(key))
                                .textFieldStyle(.roundedBorder)
                        } else {
                            TextField(key.hasSuffix("_URL") ? "https://…" : "Value", text: bindingFor(key))
                                .textFieldStyle(.roundedBorder)
                        }
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
                    .lineLimit(3)
            }

            HStack {
                Spacer()
                Button("Cancel") { onDone() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    connect()
                } label: {
                    if busy {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Connect")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(busy || !allFilled)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 420)
        .background(theme.tokens.background)
    }

    private var allFilled: Bool {
        target.missingKeys.allSatisfy { key in
            !(values[key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    private func bindingFor(_ key: String) -> Binding<String> {
        Binding(
            get: { values[key] ?? "" },
            set: { values[key] = $0 }
        )
    }

    private func connect() {
        busy = true
        errorMessage = nil
        Task {
            do {
                var trimmed: [String: String] = [:]
                for key in target.missingKeys {
                    trimmed[key] = (values[key] ?? "").trimmingCharacters(in: .whitespaces)
                }
                try monitor.saveConnectionKeys(trimmed)
            } catch {
                busy = false
                errorMessage = "Could not save keys: \(error.localizedDescription)"
                return
            }

            let outcome = await monitor.setCapability(
                agentId: agentId,
                capabilityId: target.capability.id,
                enabled: true
            )
            busy = false
            switch outcome {
            case .success:
                onDone()
            case .missingEnv(let keys):
                errorMessage = "Still missing: \(keys.joined(separator: ", "))"
            case .failure(let message):
                errorMessage = message
            }
        }
    }
}

// MARK: - Schedule picker

/// Editable schedule state backing the consumer picker. Holds the picker
/// selection plus the time/weekday details and the raw cron for Custom.
struct ScheduleDraft {
    enum Frequency: String, CaseIterable, Identifiable {
        case onDemand = "On demand"
        case hourly = "Every hour"
        case daily = "Every day"
        case weekdays = "Weekdays"
        case weekly = "Once a week"
        case custom = "Custom"

        var id: String { rawValue }
    }

    var frequency: Frequency = .onDemand
    var time: Date = ScheduleDraft.defaultTime
    var weekday: Int = 1
    var customCron: String = ""

    static var defaultTime: Date {
        Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    }

    init() {}

    init(cron: String?) {
        switch SchedulePreset.from(cron: cron) {
        case .onDemand:
            frequency = .onDemand
        case .hourly:
            frequency = .hourly
        case .daily(let hour, let minute):
            frequency = .daily
            time = Self.time(hour: hour, minute: minute)
        case .weekdays(let hour, let minute):
            frequency = .weekdays
            time = Self.time(hour: hour, minute: minute)
        case .weekly(let day, let hour, let minute):
            frequency = .weekly
            weekday = day
            time = Self.time(hour: hour, minute: minute)
        case .custom(let raw):
            frequency = .custom
            customCron = raw
        }
    }

    private static func time(hour: Int, minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }

    var cronExpression: String? {
        let hour = Calendar.current.component(.hour, from: time)
        let minute = Calendar.current.component(.minute, from: time)
        switch frequency {
        case .onDemand:
            return SchedulePreset.onDemand.cronExpression
        case .hourly:
            return SchedulePreset.hourly.cronExpression
        case .daily:
            return SchedulePreset.daily(hour: hour, minute: minute).cronExpression
        case .weekdays:
            return SchedulePreset.weekdays(hour: hour, minute: minute).cronExpression
        case .weekly:
            return SchedulePreset.weekly(weekday: weekday, hour: hour, minute: minute).cronExpression
        case .custom:
            return SchedulePreset.custom(customCron).cronExpression
        }
    }
}

/// Frequency menu + contextual time/weekday/cron inputs. Shared by the edit
/// sheet and the new-agent flow.
struct ScheduleField: View {
    @Binding var draft: ScheduleDraft

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack(spacing: NSpacing.sm) {
                Picker("", selection: $draft.frequency) {
                    ForEach(ScheduleDraft.Frequency.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(width: 150, alignment: .leading)

                if draft.frequency == .weekly {
                    Picker("", selection: $draft.weekday) {
                        ForEach(0..<7, id: \.self) { day in
                            Text(SchedulePreset.weekdayNames[day]).tag(day)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .frame(width: 130, alignment: .leading)
                }

                if showsTime {
                    Text("at")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    DatePicker("", selection: $draft.time, displayedComponents: [.hourAndMinute])
                        .datePickerStyle(.field)
                        .labelsHidden()
                }

                Spacer()
            }

            if draft.frequency == .custom {
                TextField("Cron expression, e.g. */30 9-17 * * 1-5", text: $draft.customCron)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            }

            if let cron = draft.cronExpression, draft.frequency != .onDemand {
                Text(CronEnglishFormatter.describe(cron))
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
    }

    private var showsTime: Bool {
        switch draft.frequency {
        case .daily, .weekdays, .weekly: return true
        case .onDemand, .hourly, .custom: return false
        }
    }
}
