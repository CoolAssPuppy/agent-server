import SwiftUI
import AgentServerDesignSystem
import AppKit

extension GuidedAgentCreationView {
    var fileAccessPicker: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            VStack(spacing: 0) {
                if model.resources.grants.isEmpty {
                    emptyResourceSelection
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.resources.grants.enumerated()), id: \.element.id) {
                            index, grant in
                            if index > 0 { Divider().opacity(0.4) }
                            fileGrantRow(grant)
                        }
                    }
                }
                Divider().opacity(0.4)
                resourcePickerFooter
            }
            .background(theme.tokens.card)
            .overlay(RoundedRectangle(cornerRadius: NRadius.md).stroke(theme.tokens.border))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
            pickerFailure
        }
    }

    var emptyResourceSelection: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(theme.tokens.mutedForeground)
                .accessibilityHidden(true)
            Text("No files or folders selected")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text("Nothing on this Mac is available to the agent until you choose it here.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, NSpacing.xxl)
    }

    var resourcePickerFooter: some View {
        HStack {
            Button {
                presentResourcePicker(.filesAndFolders)
            } label: {
                Label(
                    model.resources.grants.isEmpty
                        ? "Choose files or folders…"
                        : "Add files or folders…",
                    systemImage: "plus"
                )
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier(ConsumerFlowAccessibility.creationFolderPicker)
            Spacer()
            Text("View only is the safer default.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .padding(NSpacing.md)
    }

    func fileGrantRow(_ grant: CreationFileGrant) -> some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: grant.kind == .folder ? "folder" : "doc")
                .frame(width: 20)
                .foregroundStyle(theme.tokens.mutedForeground)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(URL(fileURLWithPath: grant.path).lastPathComponent)
                    .font(NTypography.bodyMedium)
                Text(grant.path)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Picker("Access for \(grant.path)", selection: accessBinding(for: grant)) {
                Text("View only").tag(CreationFileGrant.Access.readOnly)
                Text("Can make changes").tag(CreationFileGrant.Access.readWrite)
            }
            .labelsHidden()
            .frame(width: 155)
            Button("Remove \(grant.path)", systemImage: "minus.circle") {
                model.resources.remove(path: grant.path)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
        }
        .padding(NSpacing.md)
    }

    func presentResourcePicker(_ mode: CreationResourcePickerMode) {
        model.pickerError = nil
        let panel = NSOpenPanel()
        panel.canChooseFiles = mode == .filesAndFolders
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = mode.allowsMultipleSelection
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = mode == .folder
            ? "Choose the folder this agent should use."
            : "Choose the files or folders this agent may use."
        panel.begin { response in
            guard response == .OK else { return }
            chooseResources(panel.urls, mode: mode)
        }
    }

    func chooseResources(_ urls: [URL], mode: CreationResourcePickerMode) {
        model.pickerError = nil
        var candidates: [CreationResourceCandidate] = []
        for url in urls {
            guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey]),
                  let isDirectory = values.isDirectory else {
                model.pickerError = "One selected item could not be identified. Choose it again."
                return
            }
            candidates.append(CreationResourceCandidate(
                path: url.path(percentEncoded: false),
                isDirectory: isDirectory
            ))
        }
        if mode == .folder {
            switch CreationResourceSelection.folderPath(from: candidates) {
            case .success(let path): model.answer = path
            case .failure(let error): model.pickerError = error.message
            }
        } else if let error = model.resources.add(candidates, mode: mode) {
            model.pickerError = error.message
        }
    }

    @ViewBuilder
    var pickerFailure: some View {
        if let pickerError = model.pickerError {
            Label(pickerError, systemImage: "exclamationmark.triangle")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.error)
                .accessibilityLabel("File selection error: \(pickerError)")
        }
    }

    func accessBinding(for grant: CreationFileGrant) -> Binding<CreationFileGrant.Access> {
        Binding(
            get: {
                model.resources.grants.first(where: { $0.id == grant.id })?.access
                    ?? grant.access
            },
            set: { model.resources.setAccess($0, for: grant.path) }
        )
    }

    func requestNativeAccess(_ resource: CreationQuestion.NativeResource) {
        Task {
            await EventKitPermissionManager().requestAccess(for: resource)
            refreshQuestion()
        }
    }

    func openPrivacySettings(for resource: CreationQuestion.NativeResource) {
        guard let url = URL(string: resource.privacySettingsURL) else { return }
        NSWorkspace.shared.open(url)
    }
}

extension CreationQuestion.NativeResource {
    var unavailableTitle: String {
        switch self {
        case .calendar: "Calendar access is not available yet."
        case .reminders: "Reminder access is not available yet."
        case .contacts: "Contacts access is not available yet."
        }
    }

    var recoveryMessage: String {
        switch self {
        case .calendar: "Allow Agent Server to view calendars in System Settings, then check again."
        case .reminders: "Allow Agent Server to view reminders in System Settings, then check again."
        case .contacts: "Allow Agent Server to view contacts in System Settings, then check again."
        }
    }

    var systemImage: String {
        switch self {
        case .calendar: "calendar.badge.exclamationmark"
        case .reminders: "list.bullet.clipboard"
        case .contacts: "person.crop.circle.badge.exclamationmark"
        }
    }

    var privacySettingsURL: String {
        switch self {
        case .calendar: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
        case .reminders: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
        case .contacts: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"
        }
    }
}
