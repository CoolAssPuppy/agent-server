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
        .onAppear { model.loadIfNeeded() }
        .overlay(alignment: .bottomTrailing) {
            if model.showSavedToast {
                Text("Saved")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.foreground)
                    .padding(.horizontal, NSpacing.md)
                    .padding(.vertical, NSpacing.xs)
                    .background(theme.tokens.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.sm)
                            .stroke(theme.tokens.border, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                    .padding(NSpacing.md)
                    .transition(.opacity)
            }
        }
    }

    private var header: some View {
        HStack(spacing: NSpacing.xs) {
            Text(fileURL.lastPathComponent)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            if model.isDirty {
                Text("●")
                    .font(NTypography.caption)
                    .foregroundStyle(Color.yellow)
                    .help("Unsaved changes")
            }
            Spacer()
        }
        .padding(.bottom, NSpacing.xs)
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
            MarkdownEditor(text: $model.body)
                .frame(minHeight: 280)
                .padding(16)
                .background(theme.tokens.card)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(theme.tokens.border, lineWidth: 1)
                )
        }
    }

    private var saveBar: some View {
        HStack {
            if let saveError = model.saveError {
                Text(saveError)
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
            }
            Spacer()
            Button(action: model.save) {
                Text("Save")
                    .font(NTypography.bodySmall)
                    .fontWeight(.medium)
                    .foregroundStyle(model.isDirty ? Color.black : theme.tokens.mutedForeground)
                    .padding(.horizontal, NSpacing.md)
                    .padding(.vertical, NSpacing.xs)
                    .background(
                        RoundedRectangle(cornerRadius: NRadius.sm)
                            .fill(model.isDirty ? Color(red: 0.992, green: 0.722, blue: 0.090) : theme.tokens.muted)
                    )
            }
            .buttonStyle(.plain)
            .disabled(!model.isDirty)
            .keyboardShortcut("s", modifiers: .command)
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
                self.didLoad = true
                self.isDirty = false
                self.loadError = nil
            } catch {
                self.loadError = error.localizedDescription
                self.didLoad = true
            }
        }

        func save() {
            guard isDirty, loadError == nil else { return }
            let newContents = frontmatter.isEmpty ? body : frontmatter + body
            do {
                guard let data = newContents.data(using: .utf8) else {
                    saveError = "Could not encode file contents."
                    return
                }
                try data.write(to: fileURL, options: .atomic)
                lastLoadedBody = body
                isDirty = false
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
