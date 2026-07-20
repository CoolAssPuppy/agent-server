import SwiftUI
import NerdsUI

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
        .searchable(text: $query, prompt: "Find an agent")
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
            dashboardContent
        }
    }

    private var dashboardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                if !isCompact {
                    overallStatus
                }
                agentList
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.vertical, NSpacing.xl)
        }
    }

    private var overallStatus: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            SecuritySectionLabel(title: "Overall status")
            SecurityGroupedSurface {
                VStack(alignment: .leading, spacing: NSpacing.sm) {
                    if scanState.phase == .scanning {
                        scanProgress
                    } else if let dashboard {
                        completedSummary(dashboard)
                    } else if let visibleFailure = failure ?? scanFailure {
                        inlineFailure(visibleFailure)
                    }
                }
                .padding(NSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func completedSummary(_ dashboard: SecurityDashboardPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            SecurityRiskStatus(risk: highestRisk(in: dashboard), isProminent: true)
            Text(summaryLine(dashboard))
                .font(.system(size: 13))
            if dashboard.needsReviewCount > 0 {
                Label(
                    "\(dashboard.needsReviewCount) changed since the last review",
                    systemImage: "clock.badge.exclamationmark"
                )
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.warning)
            }
            if dashboard.failedCount > 0 || dashboard.pendingCount > 0 {
                Text(incompleteLine(dashboard))
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
    }

    private func inlineFailure(_ visibleFailure: ConsumerFlowFailure) -> some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(theme.tokens.destructive)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text(visibleFailure.conciseMessage)
                    .font(.system(size: 13))
                if visibleFailure.canRetry {
                    Button("Try again") { Task { await scan() } }
                        .controlSize(.small)
                }
            }
        }
    }

    private var agentList: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            SecuritySectionLabel(title: "Agents")
            if visibleAgentCount == 0 {
                Text(query.isEmpty ? "No agents to scan yet." : "No agents match your search.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                SecurityGroupedSurface {
                    if let dashboard {
                        ForEach(Array(filteredAgents(dashboard).enumerated()), id: \.element.id) { index, agent in
                            if index > 0 { Divider().opacity(0.25) }
                            dashboardAgentRow(agent)
                        }
                    } else {
                        ForEach(Array(filteredScanAgents.enumerated()), id: \.element.id) { index, agent in
                            if index > 0 { Divider().opacity(0.25) }
                            scanAgentRow(agent)
                        }
                    }
                }
            }
        }
    }

    private func dashboardAgentRow(_ agent: SecurityAgentPresentation) -> some View {
        let row = agent.securityRow(isSelected: agent.id == selectedAgentId)
        return Button { openAgent(agent.id) } label: {
            securityRow(
                title: row.title,
                detail: row.detail,
                status: row.status,
                severity: row.severity,
                isSelected: row.isSelected,
                showsDisclosure: true
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(row.isSelected ? .isSelected : [])
    }

    private func scanAgentRow(_ agent: SecurityScanAgent) -> some View {
        securityRow(
            title: agent.name,
            detail: scanDetail(agent),
            status: agent.status.displayLabel,
            severity: scanRisk(agent.status),
            isSelected: false,
            isWorking: agent.status == .analyzing,
            showsDisclosure: false
        )
        .accessibilityElement(children: .combine)
    }

    private func securityRow(
        title: String,
        detail: String,
        status: String,
        severity: ConsumerRiskLevel?,
        isSelected: Bool,
        isWorking: Bool = false,
        showsDisclosure: Bool
    ) -> some View {
        HStack(alignment: .center, spacing: NSpacing.md) {
            Group {
                if isWorking {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: rowSymbol(severity: severity, status: status))
                        .foregroundStyle(rowColor(severity: severity, status: status))
                }
            }
            .frame(width: 20)
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.tokens.foreground)
                Text(detail)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(2)
            }
            Spacer(minLength: NSpacing.sm)
            Text(status)
                .font(NTypography.caption)
                .foregroundStyle(rowColor(severity: severity, status: status))
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(theme.tokens.mutedForeground)
                .opacity(showsDisclosure ? 1 : 0)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, NSpacing.md)
        .padding(.vertical, NSpacing.sm)
        .contentShape(Rectangle())
        .background(isSelected ? theme.tokens.primary.opacity(0.08) : Color.clear)
    }

    private var scanProgress: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(spacing: NSpacing.sm) {
                ProgressView().controlSize(.small)
                Text(scanProgressTitle)
                    .font(.system(size: 13, weight: .medium))
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

    private var emptyState: some View {
        VStack(spacing: NSpacing.md) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 32))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text("Check your agents before they run")
                .font(.system(size: 15, weight: .semibold))
            Text("Find broad access, exposed credentials, risky instructions, and automatic actions.")
                .font(.system(size: 13))
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
            Button("Scan all agents") { Task { await scan() } }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(NSpacing.xxl)
    }

    private var visibleAgentCount: Int {
        dashboard.map { filteredAgents($0).count } ?? filteredScanAgents.count
    }

    private var filteredScanAgents: [SecurityScanAgent] {
        guard !query.isEmpty else { return scanState.agents }
        return scanState.agents.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private func filteredAgents(_ dashboard: SecurityDashboardPresentation) -> [SecurityAgentPresentation] {
        guard !query.isEmpty else { return dashboard.agents }
        return dashboard.agents.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private func highestRisk(in dashboard: SecurityDashboardPresentation) -> ConsumerRiskLevel {
        ConsumerRiskLevel.allCases.reversed().first {
            dashboard.agentCount(for: $0) > 0
        } ?? .low
    }

    private func summaryLine(_ dashboard: SecurityDashboardPresentation) -> String {
        let checked = dashboard.checkedCount == 1 ? "1 agent checked" : "\(dashboard.checkedCount) agents checked"
        let attention = dashboard.agents.filter {
            if case .checked(let risk, _, _) = $0.result { return risk != .low }
            return false
        }.count
        guard attention > 0 else { return "\(checked). No agents need your attention." }
        let noun = attention == 1 ? "agent needs" : "agents need"
        return "\(checked). \(attention) \(noun) your attention."
    }

    private func incompleteLine(_ dashboard: SecurityDashboardPresentation) -> String {
        var parts: [String] = []
        if dashboard.failedCount > 0 { parts.append("\(dashboard.failedCount) could not be checked") }
        if dashboard.pendingCount > 0 { parts.append("\(dashboard.pendingCount) waiting") }
        return parts.joined(separator: ", ")
    }

    private func scanDetail(_ agent: SecurityScanAgent) -> String {
        agent.failureMessage ?? {
            switch agent.status {
            case .pending: "Waiting to be checked"
            case .analyzing: "Reviewing access and instructions"
            case .checked: "Security check finished"
            case .failed: "The security check did not finish"
            }
        }()
    }

    private func scanRisk(_ status: SecurityScanAgentStatus) -> ConsumerRiskLevel? {
        if case .checked(let risk) = status { return risk }
        return nil
    }

    private func rowSymbol(severity: ConsumerRiskLevel?, status: String) -> String {
        if let severity {
            switch severity {
            case .low: return "checkmark.circle.fill"
            case .needsReview: return "exclamationmark.triangle.fill"
            case .high, .critical: return "exclamationmark.octagon.fill"
            }
        }
        return status == "Could not check" ? "exclamationmark.octagon.fill" : "clock"
    }

    private func rowColor(severity: ConsumerRiskLevel?, status: String) -> Color {
        if let severity {
            switch severity {
            case .low: return theme.tokens.success
            case .needsReview: return theme.tokens.warning
            case .high, .critical: return theme.tokens.destructive
            }
        }
        return status == "Could not check" ? theme.tokens.destructive : theme.tokens.mutedForeground
    }

    private func scan() async {
        failure = nil
        switch await actions.scanAll() {
        case .success(let result): dashboard = result
        case .failure(let error): failure = error
        }
    }
}
