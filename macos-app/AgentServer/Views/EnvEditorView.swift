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
                Text("No .env file found at ~/.agent-server/.env")
                    .foregroundStyle(.secondary)
                    .font(.callout)
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
                    Text(saveError)
                        .foregroundStyle(.red)
                        .font(.caption)
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
            Text(entry.wrappedValue.key)
                .font(.system(.body, design: .monospaced))
                .frame(width: labelWidth, alignment: .leading)
                .lineLimit(1)
                .truncationMode(.middle)

            if entry.wrappedValue.isURL {
                TextField("Value", text: entry.value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: fieldWidth)
                    .textSelection(.enabled)
                    .onChange(of: entry.wrappedValue.value) { hasChanges = true }
            } else if entry.wrappedValue.isSensitive {
                SecureField("Value", text: entry.value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: fieldWidth)
                    .onChange(of: entry.wrappedValue.value) { hasChanges = true }
            } else {
                TextField("Value", text: entry.value)
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
