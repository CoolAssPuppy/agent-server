import SwiftUI
import AgentServerDesignSystem

struct ConnectionOperationReviewSection: View {
    let onLoad: () async throws -> ConnectionOperationReviewResponse
    let onCheck: () async throws -> ConnectionReadinessResponse
    let onSave: (ConnectionOperationMappingRequest) async throws -> ConnectionOperationReviewResponse

    @Environment(\.nTheme) private var theme
    @State private var draft: ConnectionOperationMappingDraft?
    @State private var status: ConnectionOperationReviewResponse.Status = .unchecked
    @State private var isWorking = false
    @State private var feedback: String?
    @State private var isError = false

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            Text("What agents can do")
                .font(NTypography.labelMedium)
            Text(statusExplanation)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)

            if let draft {
                ForEach(Array(draft.rows.enumerated()), id: \.element.id) { index, row in
                    operationRow(index: index, row: row)
                    if index < draft.rows.count - 1 { Divider().opacity(0.25) }
                }
                Button("Save operation review", action: save)
                    .buttonStyle(.borderless)
                    .disabled(isWorking)
            } else if status == .unchecked {
                Button("Check connection", action: check)
                    .buttonStyle(.borderless)
                    .disabled(isWorking)
            }

            if isWorking { ProgressView().controlSize(.small) }
            if let feedback {
                Label(feedback, systemImage: isError ? "exclamationmark.triangle" : "checkmark.circle")
                    .font(NTypography.caption)
                    .foregroundStyle(isError ? theme.tokens.destructive : theme.tokens.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .connectionOperationSection()
        .task { await load() }
    }

    private var statusExplanation: String {
        switch status {
        case .unchecked:
            return "Check this connection to read its available tools before assigning portable operations."
        case .unmapped:
            return "Assign portable operation names to the exact tools agents may call. Unassigned tools stay unavailable."
        case .current:
            return "These mappings match the latest checked tool list."
        case .stale:
            return "The available tools changed. Review every mapping before agents use this connection again."
        }
    }

    private func operationRow(index: Int, row: ConnectionOperationMappingRow) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack {
                Text(row.runtimeName)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                Spacer()
                Text(row.effect == "read" ? "Read" : "Write")
                    .font(NTypography.caption)
                    .foregroundStyle(row.effect == "read" ? theme.tokens.mutedForeground : theme.tokens.warning)
            }
            if row.classification != "curated" && !row.semanticOperation.isEmpty {
                Picker("Reviewed behavior", selection: rowBinding(index, \.effect)) {
                    Text("Read").tag("read")
                    Text("Write").tag("write")
                }
                .pickerStyle(.segmented)
            }
            TextField(
                "Portable operation, such as notion.page.create",
                text: rowBinding(index, \.semanticOperation)
            )
            .textFieldStyle(.roundedBorder)
            if !row.semanticOperation.isEmpty && !row.inputFields.isEmpty {
                Picker("Bound resource argument", selection: rowBinding(index, \.targetArgument)) {
                    Text("No bound resource").tag("")
                    ForEach(row.inputFields, id: \.self) { Text($0).tag($0) }
                }
                if !row.targetArgument.isEmpty {
                    TextField(
                        "Resource type, such as notion.data_source",
                        text: rowBinding(index, \.resourceType)
                    )
                    .textFieldStyle(.roundedBorder)
                }
            }
        }
        .padding(.vertical, NSpacing.xs)
    }

    private func rowBinding(
        _ index: Int,
        _ keyPath: WritableKeyPath<ConnectionOperationMappingRow, String>
    ) -> Binding<String> {
        Binding(
            get: { draft?.rows[safe: index]?[keyPath: keyPath] ?? "" },
            set: { value in
                guard draft?.rows.indices.contains(index) == true else { return }
                draft?.rows[index][keyPath: keyPath] = value
            }
        )
    }

    @MainActor
    private func load() async {
        do {
            let response = try await onLoad()
            apply(response)
        } catch {
            feedback = error.localizedDescription
            isError = true
        }
    }

    private func check() {
        isWorking = true
        feedback = nil
        Task {
            do {
                _ = try await onCheck()
                await load()
            } catch {
                feedback = error.localizedDescription
                isError = true
            }
            isWorking = false
        }
    }

    private func save() {
        guard let draft else { return }
        isWorking = true
        feedback = nil
        Task {
            do {
                apply(try await onSave(draft.makeRequest()))
                feedback = "Operation review saved."
                isError = false
            } catch {
                feedback = friendlyMessage(for: error)
                isError = true
            }
            isWorking = false
        }
    }

    private func apply(_ response: ConnectionOperationReviewResponse) {
        status = response.status
        draft = try? ConnectionOperationMappingDraft(response: response)
    }

    private func friendlyMessage(for error: Error) -> String {
        switch error as? ConnectionOperationMappingError {
        case .invalidSemanticOperation(let operation):
            return "\(operation) is not a valid portable operation name."
        case .duplicateSemanticOperation(let operation):
            return "\(operation) is assigned more than once."
        case .incompleteTarget(let tool):
            return "Choose both a resource argument and resource type for \(tool)."
        case .unavailableTargetArgument(let argument):
            return "\(argument) is not declared by this tool."
        case .unchecked:
            return "Check the connection before reviewing operations."
        case nil:
            return error.localizedDescription
        }
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private extension View {
    func connectionOperationSection() -> some View {
        padding(.vertical, NSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
