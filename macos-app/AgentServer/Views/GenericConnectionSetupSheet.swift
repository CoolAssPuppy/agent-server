import SwiftUI
import NerdsUI

struct GenericConnectionSetupSheet: View {
    @ObservedObject var monitor: StatusMonitor
    let onSaved: (ConnectionProfile) -> Void
    let onCancel: () -> Void

    @Environment(\.nTheme) private var theme
    @State private var label = ""
    @State private var method: ConnectionSetupDraft.Method = .web
    @State private var webURL = ""
    @State private var command = ""
    @State private var arguments = ""
    @State private var credentials = [ConnectionCredentialDraft.suggested(targetName: "Authorization")]
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    introduction
                    identityCard
                    connectionCard
                    credentialsCard
                    technicalDetails
                }
                .padding(NSpacing.xxl)
            }
            Divider()
            actions
                .padding(.horizontal, NSpacing.xxl)
                .padding(.vertical, NSpacing.lg)
        }
        .frame(width: 560, height: 680)
        .background(theme.tokens.background)
        .accessibilityIdentifier("connectionSetup.sheet")
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text("Add connection")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text("Give agents controlled access to an app, API, or local tool. You choose the name and exactly how it connects.")
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var identityCard: some View {
        setupCard(title: "Connection name", explanation: "Use any name that helps you distinguish this account or workspace.") {
            TextField("For example, Personal Notion", text: $label)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("connectionSetup.name")
        }
    }

    private var connectionCard: some View {
        setupCard(title: "How it connects", explanation: methodExplanation) {
            Picker("Connection method", selection: $method) {
                Text("Web service").tag(ConnectionSetupDraft.Method.web)
                Text("Local command").tag(ConnectionSetupDraft.Method.local)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("connectionSetup.method")

            if method == .web {
                TextField("https://service.example/mcp", text: $webURL)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Service endpoint")
            } else {
                TextField("Command, such as npx", text: $command)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Local command")
                TextField("Arguments, separated by spaces", text: $arguments)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Command arguments")
            }
        }
    }

    private var credentialsCard: some View {
        setupCard(
            title: "Credentials",
            explanation: "Add the keys this connection needs. Values stay in the selected Agent Server folder's .env file."
        ) {
            if credentials.isEmpty {
                Text("No credentials required")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                ForEach($credentials) { $credential in
                    credentialEditor($credential)
                    if credential.id != credentials.last?.id { Divider().opacity(0.3) }
                }
            }

            Button {
                credentials.append(.suggested(targetName: method == .web ? "Authorization" : "API_KEY"))
            } label: {
                Label("Add credential", systemImage: "plus")
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("connectionSetup.addCredential")
        }
    }

    private func credentialEditor(_ credential: Binding<ConnectionCredentialDraft>) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack {
                Text(credential.wrappedValue.label)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer()
                Button {
                    credentials.removeAll { $0.id == credential.wrappedValue.id }
                } label: {
                    Image(systemName: "minus.circle")
                }
                .buttonStyle(.plain)
                .help("Remove this credential")
                .accessibilityLabel("Remove \(credential.wrappedValue.label)")
            }

            SecureField("Paste secret value", text: credential.value)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("\(credential.wrappedValue.label) value")

            DisclosureGroup("Credential details") {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    TextField("Credential name", text: credential.label)
                        .textFieldStyle(.roundedBorder)
                    TextField("Environment variable", text: credential.environmentVariable)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Environment variable name")
                    TextField(method == .web ? "Request header" : "Process variable", text: credential.targetName)
                        .textFieldStyle(.roundedBorder)
                    if method == .web {
                        TextField("Value prefix, such as Bearer ", text: credential.prefix)
                            .textFieldStyle(.roundedBorder)
                    }
                }
                .padding(.top, NSpacing.sm)
            }
            .font(NTypography.caption)
        }
        .padding(.vertical, NSpacing.xs)
    }

    private var technicalDetails: some View {
        DisclosureGroup("Technical details") {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                detailRow("Adapter", "Custom MCP")
                detailRow("Transport", method == .web ? "HTTP" : "Standard input and output")
                Text("The saved connection stores only references to the environment variables above. Secret values are never placed in the connection profile or an agent file.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.bodyMedium)
    }

    private var actions: some View {
        HStack(spacing: NSpacing.sm) {
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(NTypography.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
                    .accessibilityIdentifier("connectionSetup.error")
            }
            Spacer()
            Button("Cancel", action: onCancel)
                .keyboardShortcut(.cancelAction)
            Button(action: save) {
                if isSaving { ProgressView().controlSize(.small) } else { Text("Add connection") }
            }
            .keyboardShortcut(.defaultAction)
            .disabled(isSaving)
            .accessibilityIdentifier("connectionSetup.save")
        }
    }

    private var methodExplanation: String {
        method == .web
            ? "Connect to a service endpoint over HTTPS."
            : "Start a tool installed on this Mac when an agent needs it."
    }

    private func setupCard<Content: View>(
        title: String,
        explanation: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                Text(title).font(NTypography.bodyMedium)
                Text(explanation)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .padding(NSpacing.lg)
        .background(theme.tokens.muted.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(value).textSelection(.enabled)
        }
        .font(NTypography.caption)
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        Task {
            do {
                let draft = method == .web
                    ? ConnectionSetupDraft.web(label: label, url: webURL, credentials: credentials)
                    : ConnectionSetupDraft.local(
                        label: label,
                        command: command,
                        arguments: arguments.split(whereSeparator: \.isWhitespace).map(String.init),
                        credentials: credentials
                    )
                let request = try draft.makeRequest()
                let environmentFile = AgentServerWorkspaceStore.current().environmentFile
                let previousEnvironment = try EnvFileStore.load(from: environmentFile)
                let profile = try await ConnectionSaveTransaction.run(
                    saveCredentials: { try monitor.saveConnectionKeys(draft.environmentValues) },
                    saveProfile: {
                        switch await monitor.createConnectionProfile(request) {
                        case .success(let profile): return profile
                        case .failure(let error): throw error
                        }
                    },
                    restoreCredentials: { try? EnvFileStore.save(previousEnvironment, to: environmentFile) }
                )
                isSaving = false
                onSaved(profile)
            } catch {
                isSaving = false
                errorMessage = friendlyMessage(for: error)
            }
        }
    }

    private func friendlyMessage(for error: Error) -> String {
        guard let setupError = error as? ConnectionSetupError else {
            return "The connection could not be saved. Nothing was added."
        }
        switch setupError {
        case .missingLabel: return "Enter a connection name."
        case .invalidURL: return "Enter a secure HTTPS endpoint."
        case .missingCommand: return "Enter the command used to start this connection."
        case .invalidEnvironmentVariable(let name): return "\(name.isEmpty ? "The environment variable" : name) must use capital letters, numbers, and underscores."
        case .duplicateEnvironmentVariable(let name): return "\(name) is used by more than one credential."
        case .duplicateTargetName(let name): return "\(name) is assigned more than once."
        }
    }
}
