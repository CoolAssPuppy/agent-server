import SwiftUI
import AgentServerDesignSystem

struct SavedConnectionRow: View {
    let presentation: ConnectionProfilePresentation
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: NSpacing.md) {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .frame(width: 24)
                    .foregroundStyle(theme.tokens.foreground)
                    .accessibilityHidden(true)
                identity
                Spacer(minLength: NSpacing.md)
                Text(presentation.rowActionTitle)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.accent)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.md)
            .contentShape(Rectangle())
            .background(isSelected ? theme.tokens.accent.opacity(0.08) : Color.clear)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "\(presentation.name), \(presentation.category.label) connection, "
                + "\(presentation.rowSummary), \(presentation.statusTitle)"
        )
        .accessibilityHint("Shows connection details")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: NSpacing.xs) {
                Text(presentation.name)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                ConnectionCategoryPill(category: presentation.category)
            }
            Text(presentation.rowSummary)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
        }
    }

}

struct SavedConnectionDetailView: View {
    let presentation: ConnectionProfilePresentation
    let onBack: () -> Void
    let onModifyCredentials: () -> Void
    let onRename: (String) async throws -> ConnectionProfile
    let onDuplicate: () async throws -> ConnectionProfile
    let onCheck: () async throws -> ConnectionReadinessResponse
    let onRemove: () async throws -> Void

    @Environment(\.nTheme) private var theme
    @State private var isEditingName = false
    @State private var proposedName: String
    @State private var activeAction: Action?
    @State private var feedback: Feedback?
    @State private var confirmsRemoval = false

    private enum Action {
        case rename
        case duplicate
        case check
        case remove
    }

    private struct Feedback {
        let message: String
        let isError: Bool
    }

    init(
        presentation: ConnectionProfilePresentation,
        onBack: @escaping () -> Void,
        onModifyCredentials: @escaping () -> Void,
        onRename: @escaping (String) async throws -> ConnectionProfile,
        onDuplicate: @escaping () async throws -> ConnectionProfile,
        onCheck: @escaping () async throws -> ConnectionReadinessResponse,
        onRemove: @escaping () async throws -> Void
    ) {
        self.presentation = presentation
        self.onBack = onBack
        self.onModifyCredentials = onModifyCredentials
        self.onRename = onRename
        self.onDuplicate = onDuplicate
        self.onCheck = onCheck
        self.onRemove = onRemove
        _proposedName = State(initialValue: presentation.name)
    }

    var body: some View {
        VStack(spacing: 0) {
            detailHeader
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    readinessSection
                    sectionDivider
                    managementSection
                    sectionDivider
                    technicalDetails
                }
                .padding(.horizontal, NSpacing.xl)
                .padding(.bottom, NSpacing.xl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("connections.detail")
        .confirmationDialog(
            "Remove \(presentation.name)?",
            isPresented: $confirmsRemoval,
            titleVisibility: .visible
        ) {
            Button("Remove connection", role: .destructive) { performRemoval() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Agents will no longer be able to select this connection. Credentials in your environment file will not be deleted.")
        }
    }

    private var detailHeader: some View {
        HStack(spacing: NSpacing.sm) {
            Button(action: onBack) {
                Label("All connections", systemImage: "chevron.left")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to all connections")
            Spacer()
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var readinessSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(presentation.name)
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
                .textSelection(.enabled)
            Label(
                presentation.statusTitle,
                systemImage: presentation.status == .ready
                    ? "checkmark.circle.fill"
                    : "exclamationmark.circle"
            )
            .font(NTypography.bodyMedium)
            .foregroundStyle(
                presentation.status == .ready ? theme.tokens.success : theme.tokens.warning
            )
            Text(presentation.statusExplanation)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            Button(
                presentation.status == .ready ? "Check readiness" : "Add credentials",
                action: presentation.status == .ready ? performCheck : onModifyCredentials
            )
            .buttonStyle(.borderless)
            .disabled(isBusy)
        }
        .connectionDetailSection()
    }

    private var managementSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            Text("Manage connection")
                .font(NTypography.labelMedium)

            if isEditingName {
                HStack(spacing: NSpacing.sm) {
                    TextField("Connection name", text: $proposedName)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("connections.renameField")
                        .onSubmit { performRename() }
                    Button("Cancel") {
                        proposedName = presentation.name
                        isEditingName = false
                    }
                    Button("Save") { performRename() }
                        .disabled(trimmedProposedName.isEmpty || isBusy)
                        .keyboardShortcut(.defaultAction)
                }
            } else {
                managementButton("Rename", systemImage: "pencil", action: {
                    feedback = nil
                    isEditingName = true
                })
            }

            managementButton(
                "Duplicate",
                systemImage: "plus.square.on.square",
                tracks: .duplicate,
                action: performDuplicate
            )
            managementButton("Remove", systemImage: "trash", role: .destructive, tracks: .remove) {
                feedback = nil
                confirmsRemoval = true
            }

            if let feedback {
                Label(
                    feedback.message,
                    systemImage: feedback.isError ? "exclamationmark.triangle" : "checkmark.circle"
                )
                .font(NTypography.caption)
                .foregroundStyle(feedback.isError ? theme.tokens.destructive : theme.tokens.success)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("connections.managementFeedback")
            }
        }
        .connectionDetailSection()
    }

    private var trimmedProposedName: String {
        proposedName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isBusy: Bool { activeAction != nil }

    private func managementButton(
        _ title: String,
        systemImage: String,
        role: ButtonRole? = nil,
        tracks actionID: Action? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(role: role, action: action) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if let actionID, activeAction == actionID {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.borderless)
        .disabled(isBusy)
        .accessibilityIdentifier("connections.\(title.lowercased().replacingOccurrences(of: " ", with: ""))")
    }

    private func performRename() {
        let label = trimmedProposedName
        guard !label.isEmpty, !isBusy else { return }
        activeAction = .rename
        feedback = nil
        Task {
            do {
                let renamed = try await onRename(label)
                proposedName = renamed.label
                isEditingName = false
                feedback = Feedback(message: "Connection renamed.", isError: false)
            } catch {
                feedback = Feedback(message: error.localizedDescription, isError: true)
            }
            activeAction = nil
        }
    }

    private func performCheck() {
        guard !isBusy else { return }
        activeAction = .check
        feedback = nil
        Task {
            do {
                let result = ConnectionReadinessPresentation(response: try await onCheck())
                feedback = Feedback(
                    message: "\(result.title). \(result.explanation)",
                    isError: !result.isReady
                )
            } catch {
                feedback = Feedback(message: error.localizedDescription, isError: true)
            }
            activeAction = nil
        }
    }

    private func performDuplicate() {
        guard !isBusy else { return }
        activeAction = .duplicate
        feedback = nil
        Task {
            do {
                _ = try await onDuplicate()
            } catch {
                feedback = Feedback(message: error.localizedDescription, isError: true)
                activeAction = nil
            }
        }
    }

    private func performRemoval() {
        guard !isBusy else { return }
        activeAction = .remove
        feedback = nil
        Task {
            do {
                try await onRemove()
            } catch {
                feedback = Feedback(message: error.localizedDescription, isError: true)
                activeAction = nil
            }
        }
    }

    private var technicalDetails: some View {
        DisclosureGroup(presentation.technicalDetailsTitle) {
            VStack(alignment: .leading, spacing: NSpacing.md) {
                detailRow("Method", presentation.connectionMethod)
                detailRow("Endpoint or command", presentation.location, usesMonospacedText: true)
                HStack {
                    Text("Credential references")
                        .font(NTypography.labelMedium)
                    Spacer()
                    Button("Modify credentials", action: onModifyCredentials)
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("connections.modifyCredentials")
                }
                ForEach(presentation.credentialReferences, id: \.self) { reference in
                    Label(reference, systemImage: "key")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .textSelection(.enabled)
                }
                Text("Secret values stay in the selected Agent Server folder and are never shown here.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.bodyMedium)
        .connectionDetailSection()
    }

    private var sectionDivider: some View {
        Divider().opacity(0.35)
    }

    private func detailRow(
        _ label: String,
        _ value: String,
        usesMonospacedText: Bool = false
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: NSpacing.md) {
            Text(label)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(value)
                .font(usesMonospacedText ? .system(.caption, design: .monospaced) : NTypography.caption)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(NTypography.caption)
    }
}

private extension View {
    func connectionDetailSection() -> some View {
        modifier(ConnectionDetailSectionModifier())
    }
}

private struct ConnectionDetailSectionModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.vertical, NSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
