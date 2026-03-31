import SwiftUI
import NerdsUI

struct EnvEditorView: View {
    @State private var envFile = EnvFile.load()
    @State private var hasChanges = false
    @State private var saveError: String?
    @State private var selection: EnvEntry.ID?

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            List(selection: $selection) {
                ForEach($envFile.entries) { $entry in
                    if !entry.isComment {
                        HStack(spacing: NSpacing.sm) {
                            Image(systemName: iconForKey(entry.key))
                                .font(NTypography.caption)
                                .foregroundStyle(theme.tokens.mutedForeground)
                                .frame(width: 14)

                            TextField("KEY", text: $entry.key)
                                .font(.system(.body, design: .monospaced))
                                .textFieldStyle(.plain)
                                .frame(minWidth: 200)
                                .onChange(of: entry.key) { hasChanges = true }

                            Spacer()

                            Group {
                                if entry.isSensitive {
                                    SecureField("Value", text: $entry.value)
                                        .onChange(of: entry.value) { hasChanges = true }
                                } else {
                                    TextField("Value", text: $entry.value)
                                        .textSelection(.enabled)
                                        .onChange(of: entry.value) { hasChanges = true }
                                }
                            }
                            .textFieldStyle(.plain)
                            .frame(width: 200)
                        }
                        .tag(entry.id)
                    }
                }
            }
            .listStyle(.bordered(alternatesRowBackgrounds: true))
            .frame(minHeight: 160)

            HStack(spacing: 0) {
                Button {
                    addEntry()
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 24, height: 20)
                }
                .buttonStyle(.borderless)

                Divider()
                    .frame(height: NSpacing.lg)

                Button {
                    removeSelected()
                } label: {
                    Image(systemName: "minus")
                        .frame(width: 24, height: 20)
                }
                .buttonStyle(.borderless)
                .disabled(selection == nil)

                Spacer()

                if let saveError {
                    HStack(spacing: NSpacing.xxs) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(theme.tokens.destructive)
                        Text(saveError)
                            .foregroundStyle(theme.tokens.destructive)
                            .font(NTypography.caption)
                    }
                }

                Button("Save") {
                    save()
                }
                .disabled(!hasChanges)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
            .padding(.horizontal, NSpacing.sm)
            .padding(.vertical, NSpacing.xxs)
            .background(.bar)
        }
    }

    private func iconForKey(_ key: String) -> String {
        let k = key.uppercased()
        if k.contains("TOKEN") || k.contains("API_KEY") || k.contains("SECRET") {
            return "key.fill"
        }
        if k.contains("URL") || k.contains("HOST") || k.contains("ENDPOINT") {
            return "link"
        }
        if k.contains("PORT") {
            return "network"
        }
        if k.contains("DIR") || k.contains("PATH") {
            return "folder.fill"
        }
        if k.contains("INTERVAL") || k.contains("TIMEOUT") || k.contains("HEARTBEAT") {
            return "clock"
        }
        if k.contains("TELEGRAM") {
            return "paperplane.fill"
        }
        return "gearshape"
    }

    private func addEntry() {
        let entry = EnvEntry(key: "NEW_KEY", value: "", isComment: false)
        envFile.entries.append(entry)
        selection = entry.id
        hasChanges = true
    }

    private func removeSelected() {
        guard let selection else { return }
        envFile.entries.removeAll { $0.id == selection }
        self.selection = nil
        hasChanges = true
    }

    private func save() {
        do {
            try envFile.save()
            hasChanges = false
            saveError = nil
        } catch {
            saveError = error.localizedDescription
        }
    }
}
