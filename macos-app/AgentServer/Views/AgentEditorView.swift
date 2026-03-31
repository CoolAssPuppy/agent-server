import SwiftUI
import NerdsUI

struct AgentEditorView: View {
    let agentId: String?
    @ObservedObject var monitor: StatusMonitor

    @Environment(\.nTheme) private var theme

    @State private var content = ""
    @State private var originalContent = ""
    @State private var filename = ""
    @State private var fileURL: URL?
    @State private var saveError: String?
    @State private var showSavedBadge = false
    @State private var isEnabled = true

    private var hasChanges: Bool {
        content != originalContent
    }

    private var isRunning: Bool {
        guard let agentId else { return false }
        return monitor.activeRuns.contains { $0.agentId == agentId }
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            MarkdownEditor(text: $content)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            bottomBar
        }
        .onAppear { loadFile() }
        .onChange(of: agentId) { loadFile() }
    }

    @ViewBuilder
    private var toolbar: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: filename.hasSuffix(".md") ? "doc.richtext" : "doc.text")
                .foregroundStyle(theme.tokens.mutedForeground)

            Text(filename)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(theme.tokens.foreground)

            if hasChanges {
                Circle()
                    .fill(.orange)
                    .frame(width: 8, height: 8)
                    .help("Unsaved changes")
            }

            if showSavedBadge {
                HStack(spacing: NSpacing.xxs) {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Saved")
                }
                .font(NTypography.caption)
                .foregroundStyle(.green)
                .transition(.opacity)
            }

            Spacer()

            if let saveError {
                HStack(spacing: NSpacing.xxs) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(saveError)
                }
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.destructive)
                .lineLimit(1)
            }

            if let agentId, !agentId.isEmpty {
                Button {
                    monitor.triggerRun(agentId: agentId)
                } label: {
                    HStack(spacing: NSpacing.xxs) {
                        if isRunning {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "play.fill")
                        }
                        Text(isRunning ? "Running" : "Run")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isRunning || !isEnabled)
            }
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
    }

    @ViewBuilder
    private var bottomBar: some View {
        HStack(spacing: NSpacing.lg) {
            Toggle(isOn: $isEnabled) {
                Text("Enabled")
                    .font(NTypography.bodySmall)
            }
            .toggleStyle(.switch)
            .controlSize(.small)
            .onChange(of: isEnabled) {
                updateEnabledInContent()
            }

            Spacer()

            Button("Revert") {
                revert()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(!hasChanges)

            Button("Save") {
                save()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(!hasChanges)
            .keyboardShortcut("s", modifiers: .command)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
    }

    private func loadFile() {
        guard let agentId else {
            content = ""
            originalContent = ""
            filename = ""
            fileURL = nil
            return
        }

        if let file = AgentFile.find(agentId: agentId) {
            content = file.content
            originalContent = file.content
            filename = file.filename
            fileURL = file.url
            isEnabled = parseEnabled(from: file.content)
        }
    }

    private func revert() {
        content = originalContent
        isEnabled = parseEnabled(from: originalContent)
        saveError = nil
    }

    private func save() {
        guard let fileURL else { return }

        do {
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
            originalContent = content
            saveError = nil

            withAnimation {
                showSavedBadge = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                withAnimation {
                    showSavedBadge = false
                }
            }

            monitor.poll()
        } catch {
            saveError = error.localizedDescription
        }
    }

    private func parseEnabled(from text: String) -> Bool {
        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("enabled:") {
                let value = trimmed.dropFirst(8).trimmingCharacters(in: .whitespaces)
                return value == "true"
            }
        }
        return true
    }

    private func updateEnabledInContent() {
        let oldValue = isEnabled ? "enabled: false" : "enabled: true"
        let newValue = isEnabled ? "enabled: true" : "enabled: false"

        if content.contains(oldValue) {
            content = content.replacingOccurrences(of: oldValue, with: newValue)
        }
    }
}

// MARK: - New agent sheet

struct NewAgentSheet: View {
    @Binding var isPresented: Bool
    var onCreate: (String) -> Void

    @Environment(\.nTheme) private var theme

    @State private var filename = "my-agent"
    @State private var useMarkdown = true
    @State private var createError: String?

    private var fullFilename: String {
        let clean = filename
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: " ", with: "-")
            .lowercased()

        let ext = useMarkdown ? ".md" : ".yaml"

        if clean.hasSuffix(".md") || clean.hasSuffix(".yaml") || clean.hasSuffix(".yml") {
            return clean
        }
        return clean + ext
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xl) {
            Text("New agent")
                .font(NTypography.headlineMedium)

            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Text("Filename")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)

                HStack(spacing: NSpacing.sm) {
                    TextField("my-agent", text: $filename)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))

                    Text(useMarkdown ? ".md" : ".yaml")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .frame(width: 50)
                }
            }

            Picker("Format", selection: $useMarkdown) {
                Text("Markdown (frontmatter + body)").tag(true)
                Text("Pure YAML").tag(false)
            }
            .pickerStyle(.radioGroup)

            if let createError {
                HStack(spacing: NSpacing.xxs) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(createError)
                }
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.destructive)
            }

            HStack {
                Spacer()

                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    create()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(filename.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(NSpacing.xxl)
        .frame(width: 420)
    }

    private func create() {
        let template = useMarkdown
            ? AgentFile.newAgentMarkdownTemplate
            : AgentFile.newAgentYAMLTemplate

        let cleanedTemplate = template
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                let s = String(line)
                if s.allSatisfy({ $0 == " " }) { return "" }
                return s.hasPrefix("    ") ? String(s.dropFirst(4)) : s
            }
            .joined(separator: "\n")

        let idFromFilename = fullFilename
            .replacingOccurrences(of: ".md", with: "")
            .replacingOccurrences(of: ".yaml", with: "")
            .replacingOccurrences(of: ".yml", with: "")

        let finalContent = cleanedTemplate
            .replacingOccurrences(of: "id: new-agent", with: "id: \(idFromFilename)")
            .replacingOccurrences(of: "name: New Agent", with: "name: \(idFromFilename.replacingOccurrences(of: "-", with: " ").capitalized)")

        do {
            let file = try AgentFile.create(filename: fullFilename, content: finalContent)
            createError = nil
            isPresented = false
            onCreate(file.id)
        } catch {
            createError = error.localizedDescription
        }
    }
}
