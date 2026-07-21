import AppKit

enum SettingsWorkspaceActions {
    static func choose(current workspace: AgentServerWorkspace) -> URL? {
        let panel = NSOpenPanel()
        panel.title = "Choose an Agent Server folder"
        panel.message = "Agent Server will keep agents and private connection settings in this folder."
        panel.prompt = "Use Folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = workspace.homeDirectory.deletingLastPathComponent()
        guard panel.runModal() == .OK, let selectedURL = panel.url else { return nil }

        let alert = NSAlert()
        alert.messageText = "Use this Agent Server folder?"
        alert.informativeText = "Agents will be read from \(selectedURL.path)/agents and private settings from \(selectedURL.path)/.env. Existing files will not be moved."
        alert.addButton(withTitle: "Use Folder")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        return selectedURL
    }

    static func open(_ workspace: AgentServerWorkspace) {
        try? FileManager.default.createDirectory(
            at: workspace.homeDirectory,
            withIntermediateDirectories: true
        )
        NSWorkspace.shared.open(workspace.homeDirectory)
    }
}
