import SwiftUI
import UniformTypeIdentifiers
import AgentServerDesignSystem

private enum SecurityPanelStyle {
    static let listWidth: CGFloat = 400
    static let transitionDuration = 0.22
}

struct SecurityCenterView: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    @State private var navigation: SecurityPanelNavigationState
    @State private var exportedReport: String?
    @State private var isExporting = false
    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(monitor: StatusMonitor, router: DrawerRouter, agentId: String?) {
        self.monitor = monitor
        self.router = router
        _navigation = State(initialValue: SecurityPanelNavigationState(selectedAgentId: agentId))
    }

    var body: some View {
        TopDrawerSurface(
            title: "Security check",
            closeLabel: "Close security check",
            onClose: close,
            onEscape: stepBackOrClose,
            titleIcon: "checkmark.shield",
            titleStatus: titleStatus,
            headerActions: { headerActions }
        ) {
            securityPanels
        }
        .fileExporter(
            isPresented: $isExporting,
            document: exportedReport.map(RedactedSecurityReport.init),
            contentType: .plainText,
            defaultFilename: "Agent Server security report"
        ) { _ in exportedReport = nil }
    }

    @ViewBuilder
    private var securityPanels: some View {
        HStack(spacing: 0) {
            dashboardPanel
            if let agentId = navigation.selectedAgentId {
                Divider().opacity(0.35)
                agentPanel(agentId: agentId)
                    .id(navigation.analysisIdentity)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(
            reduceMotion ? nil : .easeInOut(duration: SecurityPanelStyle.transitionDuration),
            value: navigation.selectedAgentId
        )
    }

    @ViewBuilder
    private var dashboardPanel: some View {
        if navigation.selectedAgentId == nil {
            dashboard
                .frame(maxWidth: .infinity)
        } else {
            dashboard
                .frame(width: SecurityPanelStyle.listWidth)
        }
    }

    private var dashboard: some View {
        SecurityDashboardView(
            dashboard: monitor.securityDashboard,
            scanState: monitor.securityScanState,
            scanFailure: monitor.securityScanFailure,
            showsHeading: false,
            isCompact: navigation.selectedAgentId != nil,
            selectedAgentId: navigation.selectedAgentId,
            actions: dashboardActions,
            openAgent: { navigation.selectAgent($0) }
        )
    }

    private func agentPanel(agentId: String) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: NSpacing.sm) {
                Button {
                    _ = navigation.stepBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to all agents")
                Text(monitor.agents.first(where: { $0.id == agentId })?.name ?? agentId)
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
            }
            .padding(.horizontal, NSpacing.xl)
            .padding(.vertical, NSpacing.md)
            Divider().opacity(0.3)
            AgentSecurityAnalyzerView(
                agentName: monitor.agents.first(where: { $0.id == agentId })?.name ?? agentId,
                actions: agentActions(agentId: agentId),
                showsHeading: false,
                selectedFindingId: Binding(
                    get: { navigation.selectedFindingId },
                    set: updateSelectedFinding
                )
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func updateSelectedFinding(_ findingId: String?) {
        if let findingId {
            navigation.selectFinding(findingId)
        } else if navigation.selectedFindingId != nil {
            _ = navigation.stepBack()
        }
    }

    private func stepBackOrClose() {
        if !navigation.stepBack() {
            close()
        }
    }

    private func close() {
        router.closeSecurity()
    }

    private var titleStatus: TopDrawerTitleStatus {
        switch monitor.securityScanState.phase {
        case .scanning: .working
        case .failed: .error
        case .idle, .complete: .normal
        }
    }

    private func retry() {
        Task { _ = await monitor.scanAllSecurity() }
    }

    private var headerActions: some View {
        HStack(spacing: NSpacing.xs) {
            ForEach(panelPresentation.headerActions, id: \.self) { action in
                headerActionButton(action)
            }
        }
    }

    private var panelPresentation: SecurityPanelPresentation {
        SecurityPanelPresentation(scanPhase: monitor.securityScanState.phase)
    }

    private func headerActionButton(_ action: SecurityPanelHeaderAction) -> some View {
        Button {
            switch action {
            case .exportReport: export()
            case .scanAll: retry()
            }
        } label: {
            ZStack {
                Circle()
                    .fill(theme.tokens.muted)
                    .overlay(Circle().stroke(theme.tokens.border, lineWidth: 1))
                if action == .scanAll, monitor.securityScanState.phase == .scanning {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: action.systemImage)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            .frame(width: 28, height: 28)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(action == .scanAll && monitor.securityScanState.phase == .scanning)
        .help(action == .exportReport ? "Export redacted report" : "Scan all agents")
        .accessibilityLabel(action == .exportReport ? "Export redacted report" : "Scan all agents")
        .accessibilityIdentifier(action == .scanAll ? ConsumerFlowAccessibility.securityScanAll : "security-export-report")
    }

    private func export() {
        exportedReport = monitor.redactedSecurityReport()
        isExporting = true
    }

    private var dashboardActions: SecurityDashboardActions {
        SecurityDashboardActions(
            scanAll: { await monitor.scanAllSecurity() }
        )
    }

    private func agentActions(agentId: String) -> AgentSecurityActions {
        AgentSecurityActions(
            scan: { await monitor.analyzeSecurity(agentId: agentId) },
            reviewFix: { await monitor.reviewSecurityFix(agentId: agentId, findingId: $0) },
            applyFix: { await monitor.applySecurityFix(agentId: agentId, findingId: $0) },
            ignore: { findingId, _ in
                await monitor.acknowledgeSecurityFinding(agentId: agentId, findingId: findingId)
            },
            approveAutomaticRuns: { await monitor.approveSecurityForAutomaticRuns(agentId: agentId) }
        )
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
