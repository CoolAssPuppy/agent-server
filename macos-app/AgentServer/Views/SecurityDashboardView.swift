import SwiftUI
import AgentServerDesignSystem

struct SecurityDashboardActions {
    let scanAll: () async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure>
}

struct SecurityDashboardView: View {
    let actions: SecurityDashboardActions
    let openAgent: (String) -> Void
    let showsHeading: Bool
    let isCompact: Bool
    let selectedAgentId: String?
    let scanState: SecurityBackgroundScanState
    let scanFailure: ConsumerFlowFailure?
    let sourceDashboard: SecurityDashboardPresentation?

    @Environment(\.nTheme) private var theme
    @State private var dashboard: SecurityDashboardPresentation?
    @State private var failure: ConsumerFlowFailure?
    @State private var query = ""

    init(
        dashboard: SecurityDashboardPresentation? = nil,
        scanState: SecurityBackgroundScanState = .idle,
        scanFailure: ConsumerFlowFailure? = nil,
        showsHeading: Bool = true,
        isCompact: Bool = false,
        selectedAgentId: String? = nil,
        actions: SecurityDashboardActions,
        openAgent: @escaping (String) -> Void
    ) {
        self.actions = actions
        self.openAgent = openAgent
        self.showsHeading = showsHeading
        self.isCompact = isCompact
        self.selectedAgentId = selectedAgentId
        self.scanState = scanState
        self.scanFailure = scanFailure
        self.sourceDashboard = dashboard
        _dashboard = State(initialValue: dashboard)
    }

    var body: some View {
        VStack(spacing: 0) {
            if !isCompact && showsHeading {
                Text("Security check")
                    .font(NTypography.headlineLarge)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(NSpacing.xxl)
                Divider().opacity(0.3)
            }
            content
        }
        .onChange(of: sourceDashboard) { _, refreshed in dashboard = refreshed }
    }

    @ViewBuilder
    private var content: some View {
        if dashboard == nil, scanState.agents.isEmpty, scanState.phase != .scanning {
            if let visibleFailure = failure ?? scanFailure {
                ConsumerFlowFailureView(
                    failure: visibleFailure,
                    retry: visibleFailure.canRetry ? { Task { await scan() } } : nil
                )
                .padding(NSpacing.xxl)
            } else {
                emptyState
            }
        } else {
            VStack(spacing: 0) {
                header
                Divider().opacity(0.3)
                agentList
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            if scanState.phase == .scanning {
                scanProgress
            } else if let dashboard {
                SecuritySummaryHeader(summary: dashboard.summary)
            } else if let visibleFailure = failure ?? scanFailure {
                inlineFailure(visibleFailure)
            }
            if showsSearch {
                SecurityAgentSearchField(query: $query)
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, NSpacing.lg)
    }

    private var scanProgress: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(spacing: NSpacing.sm) {
                ProgressView().controlSize(.small)
                Text(scanProgressTitle)
                    .font(NTypography.headlineSmall)
            }
            if let current = scanState.currentAgent {
                Text("Checking \(current.name)")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            ProgressView(
                value: Double(scanState.processedCount),
                total: Double(max(scanState.agents.count, 1))
            )
            .accessibilityLabel("Security check progress")
            .accessibilityValue("\(scanState.processedCount) of \(scanState.agents.count) agents checked")
        }
    }

    private var scanProgressTitle: String {
        guard !scanState.agents.isEmpty else { return "Checking agents" }
        return "Checking \(min(scanState.processedCount + 1, scanState.agents.count)) of \(scanState.agents.count)"
    }

    private func inlineFailure(_ visibleFailure: ConsumerFlowFailure) -> some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(theme.tokens.destructive)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text(visibleFailure.conciseMessage)
                    .font(NTypography.bodyMedium)
                if visibleFailure.canRetry {
                    Button("Try again") { Task { await scan() } }
                        .controlSize(.small)
                }
            }
        }
    }

    // MARK: - List

    @ViewBuilder
    private var agentList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                if let dashboard {
                    let sections = dashboard.sections(matching: query)
                    if sections.isEmpty {
                        emptyListMessage
                    } else {
                        ForEach(sections) { section in
                            group(title: section.title) {
                                ForEach(Array(section.agents.enumerated()), id: \.element.id) { index, agent in
                                    if index > 0 { Divider().opacity(0.25) }
                                    dashboardAgentRow(agent)
                                }
                            }
                        }
                    }
                } else if filteredScanAgents.isEmpty {
                    emptyListMessage
                } else {
                    group(title: "Agents") {
                        ForEach(Array(filteredScanAgents.enumerated()), id: \.element.id) { index, agent in
                            if index > 0 { Divider().opacity(0.25) }
                            scanAgentRow(agent)
                        }
                    }
                }
            }
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, NSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func group<Rows: View>(
        title: String,
        @ViewBuilder rows: @escaping () -> Rows
    ) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            SecuritySectionLabel(title: title)
                .accessibilityAddTraits(.isHeader)
            SecurityGroupedSurface(content: rows)
        }
    }

    private var emptyListMessage: some View {
        Text(query.isEmpty ? "No agents to scan yet." : "No agents match your search.")
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
    }

    private func dashboardAgentRow(_ agent: SecurityAgentPresentation) -> some View {
        let row = agent.securityRow(isSelected: agent.id == selectedAgentId)
        return Button { openAgent(agent.id) } label: {
            SecurityAgentListRow(
                title: row.title,
                detail: row.detail,
                status: row.status,
                severity: row.severity,
                isSelected: row.isSelected
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: agent, row: row))
        .accessibilityAddTraits(row.isSelected ? .isSelected : [])
    }

    private func accessibilityLabel(
        for agent: SecurityAgentPresentation,
        row: SecurityRowPresentation
    ) -> String {
        [agent.name, row.status.isEmpty ? agent.group.title : row.status, row.detail]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }

    private func scanAgentRow(_ agent: SecurityScanAgent) -> some View {
        SecurityAgentListRow(
            title: agent.name,
            detail: agent.failureMessage ?? "",
            status: agent.status == .analyzing ? "" : agent.status.displayLabel,
            severity: scanRisk(agent.status),
            isSelected: false,
            isWorking: agent.status == .analyzing,
            showsDisclosure: false
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.status.displayLabel)")
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.md) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 32))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Check your agents before they run")
                .font(NTypography.headlineSmall)
            Text("Find broad access, exposed credentials, risky instructions, and automatic actions.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
            Button("Scan all agents") { Task { await scan() } }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(NSpacing.xxl)
    }

    // MARK: - Helpers

    private var horizontalPadding: CGFloat {
        isCompact ? NSpacing.lg : NSpacing.xxl
    }

    private var showsSearch: Bool {
        if let dashboard { return dashboard.summary.showsSearch }
        return scanState.agents.count > SecurityDashboardSummary.searchThreshold
    }

    private var filteredScanAgents: [SecurityScanAgent] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return scanState.agents }
        return scanState.agents.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private func scanRisk(_ status: SecurityScanAgentStatus) -> ConsumerRiskLevel? {
        if case .checked(let risk) = status { return risk }
        return nil
    }

    private func scan() async {
        failure = nil
        switch await actions.scanAll() {
        case .success(let result): dashboard = result
        case .failure(let error): failure = error
        }
    }
}
