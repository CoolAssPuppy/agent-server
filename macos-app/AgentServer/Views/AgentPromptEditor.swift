import SwiftUI
import NerdsUI

/// Editable prompt body for the agent detail drawer. Reads the full markdown
/// file, splits off the YAML frontmatter (kept verbatim), and exposes only the
/// body for editing. Cmd+S or the Save button writes the file back atomically.
struct AgentPromptEditor: View {
    let fileURL: URL

    @Environment(\.nTheme) private var theme
    @StateObject private var model: Loader

    init(fileURL: URL) {
        self.fileURL = fileURL
        _model = StateObject(wrappedValue: Loader(fileURL: fileURL))
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

    private var header: some View {
        // Filename is already shown by the parent section label in
        // AgentDetailDrawer as `PROMPT (filename.md)` — don't duplicate it
        // here. Only the dirty indicator earns its own row.
        HStack(spacing: NSpacing.xs) {
            if model.isDirty {
                Text("●")
                    .font(NTypography.caption)
                    .foregroundStyle(Color.yellow)
                    .help("Unsaved changes")
            }
            Spacer()
        }
        .frame(height: model.isDirty ? nil : 0)
        .padding(.bottom, model.isDirty ? NSpacing.xs : 0)
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
            // Syntax-highlighted editor (NSTextView-backed) restored. The
            // card is a fixed-height frame so the editor scrolls internally
            // instead of pushing the drawer layout to match the document
            // length.
            MarkdownEditor(text: $model.body)
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

    private var saveBar: some View {
        HStack(spacing: NSpacing.sm) {
            // Enabled toggle: flips the agent's frontmatter `enabled:` field
            // and writes the file immediately. Independent of the save/revert
            // flow on the prompt body.
            Toggle(isOn: Binding(
                get: { model.enabled },
                set: { model.setEnabled($0) }
            )) {
                Text("Enabled")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground)
            }
            .toggleStyle(.switch)
            .controlSize(.small)

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
        .padding(.top, NSpacing.sm)
    }

    // MARK: - Loader

    final class Loader: ObservableObject {
        let fileURL: URL

        @Published var body: String = "" {
            didSet {
                guard didLoad else { return }
                if body != lastLoadedBody && !isDirty {
                    isDirty = true
                }
            }
        }
        @Published var isDirty: Bool = false
        @Published var loadError: String?
        @Published var saveError: String?
        @Published var showSavedToast: Bool = false
        /// Mirrors `enabled: true|false` in the YAML frontmatter. Default true
        /// if the field is absent (matches the daemon's own default).
        @Published var enabled: Bool = true

        private var frontmatter: String = ""
        private var lastLoadedBody: String = ""
        private var didLoad = false
        private var toastTask: Task<Void, Never>?

        init(fileURL: URL) {
            self.fileURL = fileURL
        }

        func loadIfNeeded() {
            guard !didLoad else { return }
            do {
                let contents = try String(contentsOf: fileURL, encoding: .utf8)
                let doc = AgentPromptDocument(source: contents)
                self.frontmatter = doc.frontmatter
                self.body = doc.body
                self.lastLoadedBody = doc.body
                self.enabled = Self.parseEnabled(frontmatter: doc.frontmatter)
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
            isDirty = false
            saveError = nil
        }

        func setEnabled(_ newValue: Bool) {
            guard loadError == nil, enabled != newValue else { return }
            enabled = newValue
            frontmatter = Self.rewriteEnabled(in: frontmatter, to: newValue)
            writeToDisk()
        }

        func save() {
            guard isDirty, loadError == nil else { return }
            writeToDisk()
            lastLoadedBody = body
            isDirty = false
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

        private static func parseEnabled(frontmatter: String) -> Bool {
            // Scan for a line like `enabled: true` or `enabled: false`.
            // Absent → default to enabled.
            for line in frontmatter.components(separatedBy: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.lowercased().hasPrefix("enabled:") {
                    let value = trimmed.dropFirst("enabled:".count)
                        .trimmingCharacters(in: .whitespaces)
                        .lowercased()
                    return value != "false"
                }
            }
            return true
        }

        private static func rewriteEnabled(in frontmatter: String, to value: Bool) -> String {
            let lines = frontmatter.components(separatedBy: "\n")
            var mutated = false
            var output: [String] = []
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.lowercased().hasPrefix("enabled:") {
                    output.append("enabled: \(value)")
                    mutated = true
                } else {
                    output.append(line)
                }
            }
            if mutated { return output.joined(separator: "\n") }
            // Insert before closing `---` fence.
            var inserted = false
            var result: [String] = []
            var seenOpen = false
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed == "---" {
                    if seenOpen && !inserted {
                        result.append("enabled: \(value)")
                        inserted = true
                    }
                    seenOpen = true
                }
                result.append(line)
            }
            return result.joined(separator: "\n")
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
