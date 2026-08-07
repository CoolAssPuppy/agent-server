import AgentServerDesignSystem
import SwiftUI

struct AgentConnectionBindingsCard: View {
    @ObservedObject var monitor: StatusMonitor
    let agentID: String
    let uses: [String: AgentConnectionUseServerModel]
    let skillRequirements: [String: AgentSkillRequirementServerModel]

    @Environment(\.nTheme) private var theme
    @State private var profiles: [ConnectionProfile] = []
    @State private var operationReviews: [String: ConnectionOperationReviewResponse] = [:]
    @State private var draft: AgentConnectionBindingDraft?
    @State private var isSaving = false
    @State private var message: String?

    var body: some View {
        AgentSettingsCard(title: "Local requirements") {
            if let draft {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(uses.keys.sorted(), id: \.self) { useKey in
                        if let use = uses[useKey] {
                            connectionUse(useKey: useKey, use: use, draft: draft)
                        }
                    }
                    ForEach(skillRequirements.keys.sorted(), id: \.self) { skillKey in
                        if let requirement = skillRequirements[skillKey] {
                            skillRequirement(skillKey: skillKey, requirement: requirement)
                        }
                    }
                    HStack {
                        if let message {
                            Text(message)
                                .font(.system(size: 11))
                                .foregroundStyle(theme.tokens.mutedForeground)
                        }
                        Spacer()
                        Button("Save requirements", action: save)
                            .disabled(isSaving || !draft.isComplete)
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: agentID, load)
    }

    private func skillRequirement(
        skillKey: String,
        requirement: AgentSkillRequirementServerModel
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(requirement.name)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.tokens.foreground)
            Text(requirement.purpose)
                .font(.system(size: 11))
                .foregroundStyle(theme.tokens.mutedForeground)
            TextField("Local skill folder", text: skillSelection(skillKey: skillKey))
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11, design: .monospaced))
                .accessibilityLabel("\(requirement.name) local skill folder")
        }
    }

    private func connectionUse(
        useKey: String,
        use: AgentConnectionUseServerModel,
        draft: AgentConnectionBindingDraft
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(use.name)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.tokens.foreground)
            Text(use.purpose)
                .font(.system(size: 11))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Allowed operations: \(use.operations.joined(separator: ", "))")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(theme.tokens.mutedForeground)
            Picker("Connection", selection: connectionSelection(useKey: useKey)) {
                Text("Choose a saved connection").tag("")
                ForEach(profiles(for: use)) { profile in
                    Text(profile.label).tag(profile.id)
                }
            }
            .controlSize(.small)
            if profiles(for: use).isEmpty {
                Text("Check and map a saved \(use.type) connection in Connections.")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.tokens.warning)
            }
            ForEach(use.resources.keys.sorted(), id: \.self) { resourceKey in
                if let resource = use.resources[resourceKey] {
                    TextField(
                        resource.purpose,
                        text: resourceSelection(useKey: useKey, resourceKey: resourceKey)
                    )
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11, design: .monospaced))
                    .accessibilityLabel("\(use.name) \(resource.purpose) ID")
                }
            }
        }
    }

    private func profiles(for use: AgentConnectionUseServerModel) -> [ConnectionProfile] {
        profiles.filter { profile in
            let serviceType = profile.serviceType ?? profile.adapter.id.split(separator: ".").first.map(String.init)
            guard serviceType == use.type,
                  let review = operationReviews[profile.id],
                  review.status == .current else { return false }
            return use.operations.allSatisfy { review.operations[$0] != nil }
        }
    }

    private func connectionSelection(useKey: String) -> Binding<String> {
        Binding(
            get: { draft?.connectionID(for: useKey) ?? "" },
            set: { draft?.setConnectionID($0, for: useKey); message = nil }
        )
    }

    private func resourceSelection(useKey: String, resourceKey: String) -> Binding<String> {
        Binding(
            get: { draft?.resourceID(for: resourceKey, use: useKey) ?? "" },
            set: {
                draft?.setResourceID($0, resource: resourceKey, use: useKey)
                message = nil
            }
        )
    }

    private func skillSelection(skillKey: String) -> Binding<String> {
        Binding(
            get: { draft?.skillPath(for: skillKey) ?? "" },
            set: { draft?.setSkillPath($0, for: skillKey); message = nil }
        )
    }

    private func load() async {
        do {
            async let savedProfiles = monitor.connectionProfiles()
            async let savedBindings = monitor.agentBindings(id: agentID)
            let loadedProfiles = await savedProfiles
            var loadedReviews: [String: ConnectionOperationReviewResponse] = [:]
            for profile in loadedProfiles {
                if let review = try? await monitor.connectionOperationReview(id: profile.id) {
                    loadedReviews[profile.id] = review
                }
            }
            profiles = loadedProfiles
            operationReviews = loadedReviews
            draft = AgentConnectionBindingDraft(
                uses: uses,
                skillRequirements: skillRequirements,
                bindingSet: try await savedBindings
            )
        } catch {
            message = error.localizedDescription
        }
    }

    private func save() {
        guard let draft, draft.isComplete else { return }
        isSaving = true
        message = nil
        Task {
            do {
                let saved = try await monitor.updateAgentBindings(
                    id: agentID,
                    request: draft.request
                )
                self.draft = AgentConnectionBindingDraft(
                    uses: uses,
                    skillRequirements: skillRequirements,
                    bindingSet: saved
                )
                message = "Requirements saved."
            } catch {
                message = error.localizedDescription
            }
            isSaving = false
        }
    }
}
