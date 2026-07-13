import SwiftUI
import NerdsUI

/// Editable prompt body for the agent detail drawer. Reads the full markdown
/// file, splits off the YAML frontmatter (kept verbatim), and exposes only the
/// body for editing. Cmd+S or the Save button writes the file back atomically.
enum AgentPromptTab: String, CaseIterable, Identifiable {
    case prompt = "PROMPT"
    case configuration = "CONFIGURATION"
    var id: String { rawValue }
}

struct AgentPromptEditor: View {
    let fileURL: URL
    let onDefinitionChanged: () -> Void

    @Environment(\.nTheme) private var theme
    @StateObject private var model: Loader
    @State private var tab: AgentPromptTab = .prompt

    init(fileURL: URL, onDefinitionChanged: @escaping () -> Void = {}) {
        self.fileURL = fileURL
        self.onDefinitionChanged = onDefinitionChanged
        _model = StateObject(wrappedValue: Loader(
            fileURL: fileURL,
            onDefinitionChanged: onDefinitionChanged
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            editor
            saveBar
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { model.loadIfNeeded() }
    }

    /// Top row above the editor: tab picker (PROMPT | CONFIGURATION) on the
    /// left with filename + dirty dot, Enabled toggle pinned to the right.
    private var header: some View {
        HStack(alignment: .center, spacing: NSpacing.sm) {
            tabPicker
            Text("(\(fileURL.lastPathComponent))")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.7))
            if model.isDirty {
                Text("●")
                    .font(NTypography.caption)
                    .foregroundStyle(Color.yellow)
                    .help("Unsaved changes")
            }
            Spacer()
            Toggle(isOn: Binding(
                get: { model.enabled },
                set: { model.setEnabled($0) }
            )) {
                Text("Enabled")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
        }
        // Horizontal inset matches MarkdownEditor's internal 16pt padding so
        // the toggle's right edge lines up with the editor text, not with
        // the card's outer border.
        .padding(.horizontal, 16)
        .padding(.bottom, NSpacing.xs)
    }

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(AgentPromptTab.allCases) { option in
                Button {
                    tab = option
                } label: {
                    Text(option.rawValue)
                        .font(NTypography.labelSmall)
                        .foregroundStyle(
                            tab == option ? theme.tokens.foreground : theme.tokens.mutedForeground
                        )
                        .padding(.horizontal, NSpacing.sm)
                        .padding(.vertical, 3)
                        .background(
                            tab == option
                                ? theme.tokens.foreground.opacity(0.08)
                                : Color.clear
                        )
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(theme.tokens.foreground.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    @ViewBuilder
    private var editor: some View {
        if let error = model.loadError {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text("Could not open prompt file")
                    .font(NTypography.labelMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text(error)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .padding(NSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.tokens.card)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            MarkdownEditor(text: binding(for: tab))
                .frame(minHeight: 240, maxHeight: .infinity)
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(theme.tokens.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(theme.tokens.border, lineWidth: 1)
                        )
                )
        }
    }

    private func binding(for tab: AgentPromptTab) -> Binding<String> {
        switch tab {
        case .prompt: return $model.body
        case .configuration: return $model.frontmatter
        }
    }

    private var saveBar: some View {
        HStack(spacing: NSpacing.sm) {
            if let saveError = model.saveError {
                Text(saveError)
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
            } else if model.showSavedToast {
                Text("Saved")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .transition(.opacity)
            }

            Spacer()

            if model.isDirty {
                Button(action: model.revert) {
                    Text("Revert")
                        .font(NTypography.bodySmall)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.tokens.foreground)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .background(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .stroke(theme.tokens.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)

                Button(action: model.save) {
                    Text("Save")
                        .font(NTypography.bodySmall)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.black)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .background(
                            RoundedRectangle(cornerRadius: NRadius.sm)
                                .fill(Color(red: 0.992, green: 0.722, blue: 0.090))
                        )
                }
                .buttonStyle(.plain)
                .keyboardShortcut("s", modifiers: .command)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, NSpacing.sm)
    }

    // MARK: - Loader

    final class Loader: ObservableObject {
        let fileURL: URL
        let onDefinitionChanged: () -> Void

        @Published var body: String = "" {
            didSet {
                guard didLoad else { return }
                recomputeDirty()
            }
        }
        /// The YAML frontmatter block including the opening/closing `---`
        /// fences, plus a trailing newline. Exposed for editing so the
        /// CONFIGURATION tab can show and mutate the full fenced block.
        @Published var frontmatter: String = "" {
            didSet {
                guard didLoad else { return }
                recomputeDirty()
            }
        }
        @Published var isDirty: Bool = false
        @Published var loadError: String?
        @Published var saveError: String?
        @Published var showSavedToast: Bool = false

        /// Derived from the current frontmatter. Default true when the field
        /// is absent (matches the daemon's own default).
        var enabled: Bool {
            (try? AgentEnabledFileEditor.enabled(in: frontmatter)) ?? true
        }

        private var lastLoadedBody: String = ""
        private var lastLoadedFrontmatter: String = ""
        private var didLoad = false
        private var toastTask: Task<Void, Never>?

        init(fileURL: URL, onDefinitionChanged: @escaping () -> Void = {}) {
            self.fileURL = fileURL
            self.onDefinitionChanged = onDefinitionChanged
        }

        func loadIfNeeded() {
            guard !didLoad else { return }
            do {
                let contents = try String(contentsOf: fileURL, encoding: .utf8)
                let doc = AgentPromptDocument(source: contents)
                self.frontmatter = doc.frontmatter
                self.body = doc.body
                self.lastLoadedBody = doc.body
                self.lastLoadedFrontmatter = doc.frontmatter
                self.didLoad = true
                self.isDirty = false
                self.loadError = nil
            } catch {
                self.loadError = error.localizedDescription
                self.didLoad = true
            }
        }

        func revert() {
            body = lastLoadedBody
            frontmatter = lastLoadedFrontmatter
            isDirty = false
            saveError = nil
        }

        func setEnabled(_ newValue: Bool) {
            guard loadError == nil else { return }
            do {
                let updated = try AgentEnabledFileEditor.setEnabled(at: fileURL, to: newValue)
                let document = AgentPromptDocument(source: updated)
                frontmatter = document.frontmatter
                body = document.body
                lastLoadedFrontmatter = document.frontmatter
                lastLoadedBody = document.body
                saveError = nil
                recomputeDirty()
                flashSavedToast()
                onDefinitionChanged()
            } catch {
                saveError = "Save failed: \(error.localizedDescription)"
            }
        }

        func save() {
            guard isDirty, loadError == nil else { return }
            writeToDisk()
            lastLoadedBody = body
            lastLoadedFrontmatter = frontmatter
            isDirty = false
        }

        private func recomputeDirty() {
            isDirty = body != lastLoadedBody || frontmatter != lastLoadedFrontmatter
        }

        private func writeToDisk() {
            let newContents = frontmatter.isEmpty ? body : frontmatter + body
            do {
                guard let data = newContents.data(using: .utf8) else {
                    saveError = "Could not encode file contents."
                    return
                }
                try data.write(to: fileURL, options: .atomic)
                saveError = nil
                flashSavedToast()
            } catch {
                saveError = "Save failed: \(error.localizedDescription)"
            }
        }

        private func flashSavedToast() {
            toastTask?.cancel()
            showSavedToast = true
            toastTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard !Task.isCancelled else { return }
                self?.showSavedToast = false
            }
        }
    }
}
