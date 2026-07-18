import SwiftUI
import UniformTypeIdentifiers
import NerdsUI

struct SecurityDashboardActions {
    let scanAll: () async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure>
    let exportReport: () async -> Result<String, ConsumerFlowFailure>
}

struct SecurityDashboardView: View {
    let actions: SecurityDashboardActions
    let openAgent: (String) -> Void

    @Environment(\.nTheme) private var theme
    @State private var dashboard: SecurityDashboardPresentation?
    @State private var failure: ConsumerFlowFailure?
    @State private var isScanning = false
    @State private var query = ""
    @State private var exportedReport: String?
    @State private var isExporting = false

    init(
        dashboard: SecurityDashboardPresentation? = nil,
        actions: SecurityDashboardActions,
        openAgent: @escaping (String) -> Void
    ) {
        self.actions = actions
        self.openAgent = openAgent
        _dashboard = State(initialValue: dashboard)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            content
        }
        .background(theme.tokens.background)
        .searchable(text: $query, prompt: "Find an agent")
        .fileExporter(
            isPresented: $isExporting,
            document: exportedReport.map(RedactedSecurityReport.init),
            contentType: .plainText,
            defaultFilename: "Agent Server security report"
        ) { _ in exportedReport = nil }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            ConsumerFlowHeader(
                title: "Security check",
                explanation: "Review what your agents can access and where they can send information."
            )
            Button("Export redacted report") { Task { await export() } }
                .disabled(dashboard == nil)
            Button("Scan all") { Task { await scan() } }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(isScanning)
                .accessibilityIdentifier(ConsumerFlowAccessibility.securityScanAll)
        }
        .padding(NSpacing.xl)
    }

    @ViewBuilder
    private var content: some View {
        if isScanning {
            ConsumerProgressView(title: "Checking all agents", message: "The scan runs locally and never includes secret values in its results.")
        } else if let failure {
            ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? { Task { await scan() } } : nil)
                .padding(NSpacing.xl)
        } else if let dashboard {
            dashboardContent(dashboard)
        } else {
            emptyState
        }
    }

    private func dashboardContent(_ dashboard: SecurityDashboardPresentation) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                summary(dashboard)
                ConsumerSection("Agents") {
                    if filteredAgents(dashboard).isEmpty {
                        Text(query.isEmpty ? "No agents to scan yet." : "No agents match your search.")
                            .foregroundStyle(theme.tokens.mutedForeground)
                    } else {
                        ForEach(filteredAgents(dashboard)) { agent in
                            Button { openAgent(agent.id) } label: {
                                HStack(spacing: NSpacing.md) {
                                    Image(systemName: agent.isStale ? "clock.badge.exclamationmark" : "checkmark.shield")
                                        .frame(width: 24)
                                    VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                                        Text(agent.name)
                                            .font(NTypography.bodyMedium)
                                        Text(agent.isStale ? "Changed since its last review" : findingLabel(agent.findingCount))
                                            .font(NTypography.caption)
                                            .foregroundStyle(theme.tokens.mutedForeground)
                                    }
                                    Spacer()
                                    ConsumerRiskLabel(risk: agent.risk)
                                    Image(systemName: "chevron.right")
                                        .foregroundStyle(theme.tokens.mutedForeground)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider().opacity(0.3)
                        }
                    }
                }
            }
            .padding(NSpacing.xl)
        }
    }

    private func summary(_ dashboard: SecurityDashboardPresentation) -> some View {
        ConsumerSection("Overall status") {
            HStack(spacing: NSpacing.lg) {
                ForEach(ConsumerRiskLevel.allCases, id: \.self) { risk in
                    VStack(alignment: .leading, spacing: NSpacing.xxs) {
                        ConsumerRiskLabel(risk: risk)
                        Text("\(dashboard.agentCount(for: risk)) agents")
                            .font(NTypography.caption)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if dashboard.needsReviewCount > 0 {
                Label("\(dashboard.needsReviewCount) changed since the last review", systemImage: "clock.badge.exclamationmark")
                    .font(NTypography.bodyMedium)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.md) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 36))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Check your agents before they run")
                .font(NTypography.headlineSmall)
            Text("The scan looks for broad access, exposed credentials, risky instructions, and automatic actions.")
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
            Button("Scan all agents") { Task { await scan() } }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(NSpacing.xl)
    }

    private func filteredAgents(_ dashboard: SecurityDashboardPresentation) -> [SecurityAgentPresentation] {
        guard !query.isEmpty else { return dashboard.agents }
        return dashboard.agents.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private func findingLabel(_ count: Int) -> String {
        count == 1 ? "1 thing to review" : "\(count) things to review"
    }

    private func scan() async {
        isScanning = true
        failure = nil
        switch await actions.scanAll() {
        case .success(let result): dashboard = result
        case .failure(let error): failure = error
        }
        isScanning = false
    }

    private func export() async {
        switch await actions.exportReport() {
        case .success(let report):
            exportedReport = report
            isExporting = true
        case .failure(let error): failure = error
        }
    }
}

private struct RedactedSecurityReport: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    let text: String

    init(_ text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = "" }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
