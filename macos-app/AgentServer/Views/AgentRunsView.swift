import SwiftUI
import AgentServerDesignSystem

struct AgentRunsView: View {
    let agentId: String
    @ObservedObject var monitor: StatusMonitor
    @State private var runs: [Run] = []
    @State private var selectedRunId: String?
    @State private var selectedRunLogs: [PanelLog] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var pollTimer: Timer?
    @State private var selectionCoordinator = RunSelectionCoordinator()
    @State private var refreshCoordinator = RunRefreshCoordinator()
    @State private var refreshTask: Task<Void, Never>?
    @ObservedObject private var router = DrawerRouter.shared

    @Environment(\.nTheme) private var theme

    private let localClient = AgentServerClient()
    private let panelClient = PanelClient.fromEnv()

    init(
        agentId: String,
        monitor: StatusMonitor,
        initiallySelectedRunId: String? = nil
    ) {
        self.agentId = agentId
        self.monitor = monitor
        _selectedRunId = State(initialValue: initiallySelectedRunId)
    }

    private var hasActiveRuns: Bool {
        runs.contains { $0.isActive }
    }

    var body: some View {
        HStack(spacing: 0) {
            runList
                .frame(width: 260)

            if selectedRunId != nil {
                Divider()
                runDetail
                    .frame(maxWidth: .infinity)
            }
        }
        .task(id: agentId) { requestRefresh() }
        .onChange(of: agentId) { _, _ in
            // Switching agents while the Runs tab is open must reset the
            // selection and list — otherwise the header updates to the new
            // agent but the pane keeps showing the previous agent's runs.
            runs = []
            selectedRunId = nil
            selectedRunLogs = []
            isLoading = true
            loadError = nil
            stopPolling()
            requestRefresh()
        }
        .onChange(of: monitor.activeRuns.count) { _, _ in
            requestRefresh()
        }
        .onChange(of: hasActiveRuns) { _, isActive in
            if isActive { startPolling() } else { stopPolling() }
        }
        .task(id: selectedRunId) { await loadSelectedRun(selectedRunId) }
        .onDisappear {
            stopPolling()
            cancelRefresh()
        }
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
            Task { @MainActor in
                requestRefresh()
                if let id = selectedRunId,
                   runs.first(where: { $0.runId == id })?.isActive == true {
                    await loadSelectedRun(id)
                }
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func requestRefresh() {
        refreshTask?.cancel()
        let token = refreshCoordinator.begin(agentId: agentId)
        refreshTask = Task { await fetchRuns(token) }
    }

    private func cancelRefresh() {
        refreshCoordinator.cancel()
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: - Run list

    private var runList: some View {
        VStack(spacing: 0) {
            if isLoading {
                Spacer()
                ProgressView().controlSize(.small)
                Spacer()
            } else if runs.isEmpty {
                Spacer()
                VStack(spacing: NSpacing.sm) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: NIconSize.lg))
                        .foregroundStyle(theme.tokens.mutedForeground.opacity(0.4))
                    Text(loadError ?? "No runs yet")
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                Spacer()
            } else {
                List(runs, selection: $selectedRunId) { run in
                    RunRow(run: run, isSelected: selectedRunId == run.runId)
                        .tag(run.runId)
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Run detail

    @ViewBuilder
    private var runDetail: some View {
        if let selectedRunId, let run = runs.first(where: { $0.runId == selectedRunId }) {
            RunDetailView(
                run: run,
                logs: selectedRunLogs,
                onCancel: {
                    Task {
                        monitor.cancelRun(id: selectedRunId)
                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                        requestRefresh()
                    }
                },
                onDelete: {
                    Task {
                        if !monitor.isDemoMode {
                            try? await localClient.deleteRun(id: selectedRunId)
                        }
                        self.selectedRunId = nil
                        requestRefresh()
                    }
                },
                onDebug: run.status == .failed ? {
                    router.openDebugger(runId: selectedRunId)
                } : nil,
                decisions: monitor.pendingDecisions.filter { $0.taskRunId == selectedRunId }
            )
        } else {
            ContentUnavailableView(
                "Select a run",
                systemImage: "text.document.fill",
                description: Text("Choose a run from the list to view details.")
            )
        }
    }

    // MARK: - Data fetching

    private func fetchRuns(_ token: RunRefreshCoordinator.Token) async {
        if let demoRuns = monitor.demoRuns(for: token.agentId) {
            guard refreshCoordinator.canApply(token), !Task.isCancelled else { return }
            runs = demoRuns
            isLoading = false
            loadError = nil
            if selectedRunId == nil { selectedRunId = demoRuns.first?.runId }
            return
        }
        do {
            let fetched: [Run]
            if let panelRuns = try await fetchFromPanel(agentId: token.agentId) {
                let localRuns = (try? await fetchFromLocalServer(agentId: token.agentId)) ?? []
                fetched = StableRunMerge.merge(
                    panel: panelRuns,
                    local: localRuns,
                    id: \Run.runId,
                    isActive: \Run.isActive
                )
            } else {
                fetched = try await fetchFromLocalServer(agentId: token.agentId)
            }
            guard refreshCoordinator.canApply(token), !Task.isCancelled else { return }
            runs = fetched
            isLoading = false
            loadError = nil

            if selectedRunId == nil, let first = fetched.first {
                selectedRunId = first.runId
            }
        } catch {
            guard refreshCoordinator.canApply(token), !Task.isCancelled else { return }
            isLoading = false
            loadError = "Could not load runs"
        }
    }

    private func fetchFromPanel(agentId: String) async throws -> [Run]? {
        guard let panelClient,
              let name = monitor.agents.first(where: { $0.id == agentId })?.name else { return nil }
        let panelRuns = try await panelClient.fetchRuns(agent: name)
        return panelRuns.map { $0.toRun(agentId: agentId) }
    }

    private func fetchFromLocalServer(agentId: String) async throws -> [Run] {
        try await localClient.runsForAgent(id: agentId)
    }

    private func loadSelectedRun(_ runId: String?) async {
        guard let request = selectionCoordinator.select(runId) else {
            selectedRunLogs = []
            return
        }

        async let logs = logsForRun(request.runId)
        async let hydratedRun = hydratedRunFromPanel(request.runId)
        let (loadedLogs, loadedRun) = await (logs, hydratedRun)

        guard selectionCoordinator.accepts(request) else { return }
        selectedRunLogs = loadedLogs
        if let loadedRun,
           let index = runs.firstIndex(where: { $0.runId == request.runId }) {
            runs[index] = loadedRun
        }
    }

    private func hydratedRunFromPanel(_ runId: String) async -> Run? {
        guard !monitor.isDemoMode, let panelClient else { return nil }
        guard let localRun = runs.first(where: { $0.runId == runId }) else { return nil }
        do {
            guard let panelRun = try await panelClient.fetchRun(id: runId) else { return nil }
            guard panelRun.id == runId else { return nil }
            return mergeFields(
                local: localRun,
                panel: panelRun.toRun(agentId: localRun.agentId)
            )
        } catch {
            return nil
        }
    }

    private func mergeFields(local: Run, panel: Run) -> Run {
        Run(
            runId: local.runId,
            agentId: local.agentId,
            agentName: local.agentName,
            status: local.status,
            startedAt: local.startedAt,
            completedAt: local.completedAt ?? panel.completedAt,
            summary: local.summary ?? panel.summary,
            error: local.error ?? panel.error,
            code: local.code ?? panel.code,
            turnCount: local.turnCount > 0 ? local.turnCount : panel.turnCount,
            toolsUsed: local.toolsUsed.isEmpty ? panel.toolsUsed : local.toolsUsed,
            filesRead: local.filesRead.isEmpty ? panel.filesRead : local.filesRead,
            filesWritten: local.filesWritten.isEmpty ? panel.filesWritten : local.filesWritten,
            commandsRun: local.commandsRun.isEmpty ? panel.commandsRun : local.commandsRun,
            progressMessages: local.progressMessages.isEmpty ? panel.progressMessages : local.progressMessages,
            accomplishments: local.accomplishments.isEmpty ? panel.accomplishments : local.accomplishments,
            observations: local.observations.isEmpty ? panel.observations : local.observations,
            trigger: local.trigger ?? panel.trigger,
            model: local.model ?? panel.model,
            inputTokens: local.inputTokens ?? panel.inputTokens,
            outputTokens: local.outputTokens ?? panel.outputTokens,
            estimatedCostUsd: (local.estimatedCostUsd ?? 0) > 0 ? local.estimatedCostUsd : panel.estimatedCostUsd,
            durationMs: local.durationMs ?? panel.durationMs,
            conversationId: local.conversationId ?? panel.conversationId
        )
    }

    private func logsForRun(_ runId: String) async -> [PanelLog] {
        guard !monitor.isDemoMode else {
            return []
        }
        guard let panelClient else { return [] }
        do {
            return try await panelClient.fetchLogs(runId: runId)
        } catch {
            return []
        }
    }
}

// MARK: - Run row

private struct RunRow: View {
    let run: Run
    var isSelected: Bool = false

    @Environment(\.nTheme) private var theme

    /// Primary text color. When selected the row draws on a saturated blue
    /// background, which washes out the theme's muted foreground. Flip to
    /// white in that state so the date stays readable.
    private var primaryColor: Color {
        isSelected ? .white : theme.tokens.foreground
    }

    /// Secondary text color. White-at-85%-opacity reads cleanly on the blue
    /// selection background in both light and dark mode.
    private var secondaryColor: Color {
        isSelected ? Color.white.opacity(0.85) : theme.tokens.mutedForeground
    }

    private var accessibilityPresentation: RunRowAccessibilityPresentation {
        RunRowAccessibilityPresentation(
            status: run.status.displayLabel,
            date: run.startedAt.formatted(date: .long, time: .omitted),
            time: run.startedAt.formatted(date: .omitted, time: .shortened),
            turnCount: run.turnCount,
            duration: run.duration.map(formatDuration),
            estimatedCost: run.estimatedCostUsd.flatMap { $0 > 0 ? formatCost($0) : nil },
            hasConversation: run.conversationId != nil
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.sm) {
            StatusIndicator(status: run.status)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                // Date on its own line so the longest metric row can stretch
                // the full width of the 260px column without wrapping mid-word.
                HStack(spacing: NSpacing.xs) {
                    Text(run.startedAt, style: .date)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(primaryColor)
                        .lineLimit(1)
                    Text(run.startedAt, style: .time)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(secondaryColor)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if run.status == .running {
                        PulsingDot(color: .green)
                    }
                }

                metaRow
            }
        }
        .padding(.vertical, NSpacing.xxs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityPresentation.label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// Compact metric row: icon + number, no long labels. Keeps every item on
    /// a single line within the 260px column regardless of how many metrics
    /// are populated.
    @ViewBuilder
    private var metaRow: some View {
        HStack(spacing: NSpacing.sm) {
            if run.conversationId != nil {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(NTypography.caption)
                    .foregroundStyle(isSelected ? Color.white : .purple)
            }

            if run.turnCount > 0 {
                metric(icon: "arrow.trianglehead.2.counterclockwise", text: "\(run.turnCount)")
                    .help("\(run.turnCount) turns")
            }

            if let duration = run.duration {
                metric(icon: "clock", text: formatDuration(duration))
                    .help("Duration")
            }

            if let cost = run.estimatedCostUsd, cost > 0 {
                metric(icon: "dollarsign.circle", text: formatCost(cost))
                    .help(InfoTooltip.costExplanation)
            }

            Spacer(minLength: 0)
        }
        .lineLimit(1)
    }

    private func metric(icon: String, text: String) -> some View {
        HStack(spacing: NSpacing.xxs) {
            Image(systemName: icon)
                .font(NTypography.caption)
                .foregroundStyle(secondaryColor)
            Text(text)
                .font(NTypography.caption)
                .foregroundStyle(secondaryColor)
                .monospacedDigit()
        }
        .fixedSize()
    }
}
