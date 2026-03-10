import SwiftUI

struct EnvEditorView: View {
    @State private var envFile = EnvFile.load()
    @State private var hasChanges = false
    @State private var saveError: String?

    private let labelWidth: CGFloat = 220
    private let fieldWidth: CGFloat = 240

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if envFile.entries.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "doc.badge.plus")
                        .foregroundStyle(.secondary)
                    Text("No .env file found at ~/.agent-server/.env")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                }
            } else {
                ForEach($envFile.entries) { $entry in
                    if !entry.isComment {
                        envRow(entry: $entry)
                    }
                }
            }

            HStack {
                Button {
                    addEntry()
                } label: {
                    Label("Add variable", systemImage: "plus")
                }
                .buttonStyle(.borderless)

                Spacer()

                if let saveError {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(saveError)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }

                Button("Save") {
                    save()
                }
                .disabled(!hasChanges)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
    }

    @ViewBuilder
    private func envRow(entry: Binding<EnvEntry>) -> some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: iconForKey(entry.wrappedValue.key))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 14)

                Text(entry.wrappedValue.key)
                    .font(.system(.body, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .frame(width: labelWidth, alignment: .leading)

            if entry.wrappedValue.isURL {
                TextField("", text: entry.value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: fieldWidth)
                    .textSelection(.enabled)
                    .onChange(of: entry.wrappedValue.value) { hasChanges = true }
            } else if entry.wrappedValue.isSensitive {
                SecureField("", text: entry.value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: fieldWidth)
                    .onChange(of: entry.wrappedValue.value) { hasChanges = true }
            } else {
                TextField("", text: entry.value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: fieldWidth)
                    .onChange(of: entry.wrappedValue.value) { hasChanges = true }
            }

            Button(role: .destructive) {
                removeEntry(entry.wrappedValue)
            } label: {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless)
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
        envFile.entries.append(EnvEntry(key: "NEW_KEY", value: "", isComment: false))
        hasChanges = true
    }

    private func removeEntry(_ entry: EnvEntry) {
        envFile.entries.removeAll { $0.id == entry.id }
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
