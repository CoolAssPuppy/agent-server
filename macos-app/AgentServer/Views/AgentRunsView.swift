import SwiftUI
import NerdsUI

struct AgentRunsView: View {
    let agentId: String
    @ObservedObject var monitor: StatusMonitor
    @State private var runs: [Run] = []
    @State private var selectedRunId: String?
    @State private var selectedRunLogs: [PanelLog] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var pollTimer: Timer?

    @Environment(\.nTheme) private var theme

    private let localClient = AgentServerClient()
    private let panelClient = PanelClient.fromEnv()

    private var agentName: String? {
        monitor.agents.first(where: { $0.id == agentId })?.name
    }

    private var hasActiveRuns: Bool {
        runs.contains { $0.isActive }
    }

    var body: some View {
        HStack(spacing: 0) {
            runList
                .frame(width: 230)

            if selectedRunId != nil {
                Divider()
                runDetail
                    .frame(maxWidth: .infinity)
            }
        }
        .task { await fetchRuns() }
        .onChange(of: monitor.activeRuns.count) { _, _ in
            Task { await fetchRuns() }
        }
        .onChange(of: hasActiveRuns) { _, isActive in
            if isActive { startPolling() } else { stopPolling() }
        }
        .onChange(of: selectedRunId) { _, newId in
            Task { await fetchLogsForRun(newId) }
        }
        .onDisappear { stopPolling() }
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
            Task { @MainActor in
                await fetchRuns()
                if let id = selectedRunId,
                   runs.first(where: { $0.runId == id })?.isActive == true {
                    await fetchLogsForRun(id)
                }
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
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
                    RunRow(run: run)
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
            RunDetailView(run: run, logs: selectedRunLogs, onCancel: {
                Task {
                    monitor.cancelRun(id: selectedRunId)
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    await fetchRuns()
                }
            })
        } else {
            ContentUnavailableView(
                "Select a run",
                systemImage: "text.document.fill",
                description: Text("Choose a run from the list to view details.")
            )
        }
    }

    // MARK: - Data fetching

    private func fetchRuns() async {
        do {
            let fetched: [Run]
            if let panelRuns = try await fetchFromPanel() {
                let localRuns = (try? await fetchFromLocalServer()) ?? []
                fetched = mergeRuns(panel: panelRuns, local: localRuns)
            } else {
                fetched = try await fetchFromLocalServer()
            }
            runs = fetched
            isLoading = false
            loadError = nil

            if selectedRunId == nil, let first = fetched.first {
                selectedRunId = first.runId
            }
        } catch {
            isLoading = false
            loadError = "Could not load runs"
        }
    }

    private func mergeRuns(panel: [Run], local: [Run]) -> [Run] {
        let localById = Dictionary(local.map { ($0.runId, $0) }, uniquingKeysWith: { _, last in last })

        // For each panel run, prefer local data if we can match by ID or start time.
        // Active runs get local data (has live progress); completed runs keep panel data (has full result).
        var matchedLocalStartTimes = Set<Int>()
        var matchedLocalIds = Set<String>()

        var merged = panel.map { panelRun -> Run in
            // Exact ID match
            if let localRun = localById[panelRun.runId] {
                matchedLocalIds.insert(localRun.runId)
                matchedLocalStartTimes.insert(Int(localRun.startedAt.timeIntervalSince1970))
                return panelRun.isActive ? localRun : panelRun
            }
            // Fuzzy time match (panel and local use different IDs for the same run)
            if let localRun = local.first(where: {
                abs($0.startedAt.timeIntervalSince(panelRun.startedAt)) < 10
            }) {
                matchedLocalIds.insert(localRun.runId)
                matchedLocalStartTimes.insert(Int(localRun.startedAt.timeIntervalSince1970))
                return panelRun.isActive ? localRun : panelRun
            }
            return panelRun
        }

        // Add local-only runs not matched to any panel run
        let localOnly = local.filter { localRun in
            !matchedLocalIds.contains(localRun.runId) &&
            !matchedLocalStartTimes.contains(Int(localRun.startedAt.timeIntervalSince1970))
        }
        merged.insert(contentsOf: localOnly, at: 0)

        return merged
    }

    private func fetchFromPanel() async throws -> [Run]? {
        guard let panelClient, let name = agentName else { return nil }
        let panelRuns = try await panelClient.fetchRuns(agent: name)
        return panelRuns.map { $0.toRun(agentId: agentId) }
    }

    private func fetchFromLocalServer() async throws -> [Run] {
        try await localClient.runsForAgent(id: agentId)
    }

    private func fetchLogsForRun(_ runId: String?) async {
        guard let runId, let panelClient else {
            selectedRunLogs = []
            return
        }
        do {
            selectedRunLogs = try await panelClient.fetchLogs(runId: runId)
        } catch {
            selectedRunLogs = []
        }
    }
}

// MARK: - Run row

private struct RunRow: View {
    let run: Run

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            StatusIndicator(status: run.status)

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                HStack(spacing: NSpacing.xs) {
                    Text(run.startedAt, style: .date)
                        .font(NTypography.labelMedium)
                    Text(run.startedAt, style: .time)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }

                HStack(spacing: NSpacing.sm) {
                    if run.conversationId != nil {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(NTypography.caption)
                            .foregroundStyle(.purple)
                    }

                    if run.turnCount > 0 {
                        Label("\(run.turnCount) turns", systemImage: "arrow.trianglehead.2.counterclockwise")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }

                    if let duration = run.duration {
                        Label(formatDuration(duration), systemImage: "clock")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }

                    if let cost = run.estimatedCostUsd, cost > 0 {
                        Label(formatCost(cost), systemImage: "dollarsign.circle")
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
            }

            Spacer()

            if run.status == .running {
                PulsingDot(color: .green)
            }
        }
        .padding(.vertical, NSpacing.xxs)
    }
}
