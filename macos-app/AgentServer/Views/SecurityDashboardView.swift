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
                header
                Divider().opacity(0.3)
            }
            content
        }
        .background(theme.tokens.background)
        .searchable(text: $query, prompt: "Find an agent")
        .onChange(of: sourceDashboard) { _, refreshed in
            dashboard = refreshed
        }
    }

    private var header: some View {
        Text("Security check")
            .font(NTypography.headlineLarge)
            .foregroundStyle(theme.tokens.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(NSpacing.xl)
    }

    @ViewBuilder
    private var content: some View {
        if scanState.phase == .scanning, dashboard == nil {
            scanningContent
        } else if let visibleFailure = failure ?? scanFailure, dashboard == nil {
            ConsumerFlowFailureView(
                failure: visibleFailure,
                retry: visibleFailure.canRetry ? { Task { await scan() } } : nil
            )
                .padding(NSpacing.xl)
        } else if let dashboard {
            dashboardContent(dashboard)
        } else {
            emptyState
        }
    }

    private var scanningContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                ConsumerSection("Overall status") { scanProgress }
                    .padding(.bottom, NSpacing.md)
                ConsumerSection("Agents") {
                    ForEach(scanState.agents) { agent in
                        HStack(spacing: NSpacing.md) {
                            scanAgentIcon(agent.status)
                                .frame(width: 24)
                            Text(agent.name)
                                .font(NTypography.bodyMedium)
                            Spacer()
                            Text(agent.status.displayLabel)
                                .font(NTypography.caption)
                                .foregroundStyle(scanAgentColor(agent.status))
                        }
                        .padding(.vertical, NSpacing.xxs)
                        Divider().opacity(0.3)
                    }
                }
            }
            .padding(NSpacing.xl)
        }
    }

    @ViewBuilder
    private func scanAgentIcon(_ status: SecurityScanAgentStatus) -> some View {
        switch status {
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(scanAgentColor(status))
        case .analyzing:
            ProgressView().controlSize(.small)
        case .checked(.low):
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(scanAgentColor(status))
        case .checked(.needsReview):
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(scanAgentColor(status))
        case .checked(.high), .checked(.critical), .failed:
            Image(systemName: "exclamationmark.octagon.fill")
                .foregroundStyle(scanAgentColor(status))
        }
    }

    private func scanAgentColor(_ status: SecurityScanAgentStatus) -> Color {
        switch status {
        case .failed: theme.tokens.destructive
        case .checked(.low): theme.tokens.success
        case .checked(.needsReview): theme.tokens.warning
        case .checked(.high), .checked(.critical): theme.tokens.destructive
        case .pending, .analyzing: theme.tokens.mutedForeground
        }
    }

    private func dashboardContent(_ dashboard: SecurityDashboardPresentation) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                if !isCompact {
                    summary(dashboard)
                        .padding(.bottom, NSpacing.md)
                }
                if let scanFailure {
                    ConsumerFlowFailureView(
                        failure: scanFailure,
                        retry: scanFailure.canRetry ? { Task { await scan() } } : nil
                    )
                }
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
                            .padding(.vertical, NSpacing.xxs)
                            .background(
                                agent.id == selectedAgentId
                                    ? theme.tokens.primary.opacity(0.08)
                                    : Color.clear
                            )
                            .accessibilityAddTraits(agent.id == selectedAgentId ? .isSelected : [])
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
            if scanState.phase == .scanning {
                scanProgress
            } else {
                HStack(alignment: .top, spacing: NSpacing.lg) {
                    ForEach(ConsumerRiskLevel.allCases, id: \.self) { risk in
                        VStack(alignment: .leading, spacing: NSpacing.xxs) {
                            ConsumerRiskLabel(risk: risk)
                            Text("\(dashboard.agentCount(for: risk)) agents")
                                .font(NTypography.caption)
                                .frame(maxWidth: .infinity, alignment: .leading)
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
    }

    private var scanProgress: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(scanProgressTitle)
                .font(NTypography.bodyMedium)
            if let current = scanState.currentAgent {
                Text("Analyzing \(current.name) now.")
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
        failure = nil
        switch await actions.scanAll() {
        case .success(let result): dashboard = result
        case .failure(let error): failure = error
        }
    }

}
