import SwiftUI
import NerdsUI

struct AgentProposalView: View {
    let proposal: AgentProposalPresentation
    var onSetUpConnections: (() -> Void)? = nil

    @Environment(\.nTheme) private var theme
    @State private var showsInstructions = false
    @State private var showsAdvanced = false

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            ConsumerSection("What this agent will do") {
                Text(proposal.explanation)
                    .font(NTypography.bodyLarge)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ConsumerSection("When it will run") {
                Label(proposal.schedule, systemImage: "calendar.badge.clock")
                    .font(NTypography.bodyMedium)
            }
            if !proposal.connections.isEmpty { connections }
            if !proposal.fileAccess.isEmpty { files }
            if !proposal.calendarAccess.isEmpty { calendars }
            if !proposal.reminderAccess.isEmpty { reminders }
            permissions
            safety
            instructions
        }
    }

    private var reminders: some View {
        ConsumerSection("Reminder lists this agent can access") {
            VStack(spacing: NSpacing.xs) {
                ForEach(proposal.reminderAccess, id: \.id) { access in
                    HStack {
                        Image(systemName: "list.bullet.clipboard")
                        Text(access.name)
                        Spacer()
                        Text(access.actions.joined(separator: ", "))
                            .font(NTypography.badge)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var calendars: some View {
        ConsumerSection("Calendars this agent can access") {
            VStack(spacing: NSpacing.xs) {
                ForEach(proposal.calendarAccess, id: \.id) { access in
                    HStack {
                        Image(systemName: "calendar")
                        Text(access.name)
                        Spacer()
                        Text(access.canEdit ? "Can add and change events" : "View only")
                            .font(NTypography.badge)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var connections: some View {
        ConsumerSection("Apps and services") {
            VStack(spacing: NSpacing.xs) {
                ForEach(proposal.connections, id: \.name) { connection in
                    HStack {
                        Image(systemName: serviceIcon(connection.name))
                            .frame(width: 22)
                            .accessibilityHidden(true)
                        Text(connection.name)
                            .font(NTypography.bodyMedium)
                        Spacer()
                        Text(connection.state.title)
                            .font(NTypography.badge)
                            .foregroundStyle(connection.state == .connected ? theme.tokens.success : theme.tokens.warning)
                        if connection.isRequired,
                           connection.state == .needsSetup,
                           let onSetUpConnections {
                            Button("Set up", action: onSetUpConnections)
                                .accessibilityLabel("Set up \(connection.name)")
                                .accessibilityIdentifier(ConsumerFlowAccessibility.creationConnectionSetup)
                        }
                    }
                    if !connection.reason.isEmpty {
                        Text(connection.reason)
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !connection.isRequired, connection.state != .connected {
                        Text("Optional. You can skip this connection.")
                            .font(NTypography.captionSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private var files: some View {
        ConsumerSection("Files this agent can access") {
            VStack(spacing: NSpacing.xs) {
                ForEach(proposal.fileAccess, id: \.path) { access in
                    HStack {
                        Image(systemName: "folder")
                        Text(access.path)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        Text(access.canEdit ? "Can make changes" : "Read-only")
                            .font(NTypography.badge)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var permissions: some View {
        ConsumerSection("What it is allowed to do") {
            if proposal.permissions.isEmpty {
                Text("No extra access requested")
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    ForEach(proposal.permissions, id: \.self) { permission in
                        Label(permission, systemImage: "checkmark.circle")
                            .font(NTypography.bodyLarge)
                    }
                }
            }
        }
    }

    private var safety: some View {
        ConsumerSection("Safety summary") {
            HStack(alignment: .top, spacing: NSpacing.sm) {
                ConsumerRiskLabel(risk: proposal.risk)
                Text(proposal.riskReason)
                    .font(NTypography.bodyLarge)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var instructions: some View {
        ConsumerSection("Instructions preview") {
            Text(proposal.instructions)
                .font(NTypography.bodyLarge)
                .lineLimit(showsInstructions ? nil : 6)
                .textSelection(.enabled)
            Button(showsInstructions ? "Show less" : "Read all instructions") {
                showsInstructions.toggle()
            }
            .buttonStyle(.borderless)
            DisclosureGroup("Advanced configuration", isExpanded: $showsAdvanced) {
                Text("The generated agent file will remain compatible with Agent Server. Secrets are stored as secure references and are never shown here.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.top, NSpacing.xs)
            }
        }
    }

    private func serviceIcon(_ name: String) -> String {
        switch name.lowercased() {
        case "slack": return "bubble.left.and.text.bubble.right"
        case "github": return "chevron.left.forwardslash.chevron.right"
        case "telegram": return "paperplane"
        default: return "app.connected.to.app.below.fill"
        }
    }
}
