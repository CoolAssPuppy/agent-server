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

    private let localClient = AgentServerClient()

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
                if isActive {
                    startPolling()
                } else {
                    stopPolling()
                }
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
                ProgressView()
                    .controlSize(.small)
                Spacer()
            } else if runs.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 28))
                        .foregroundStyle(.quaternary)
                    Text(loadError ?? "No runs yet")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
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

    /// Panel data has full history but no live progress for in-progress runs.
    /// Local server data has live progress (turns, tools) but limited history.
    /// Merge by preferring local data for running runs (it has progress),
    /// and panel data for everything else (it has the full result).
    private func mergeRuns(panel: [Run], local: [Run]) -> [Run] {
        let localById = Dictionary(local.map { ($0.runId, $0) }, uniquingKeysWith: { _, last in last })

        // Replace active panel runs with local data (has live progress).
        // Match by runId first, then by start time proximity (panel and local use different IDs).
        var matched = panel.map { panelRun -> Run in
            if panelRun.isActive, let localRun = localById[panelRun.runId] {
                return localRun
            }
            if panelRun.isActive, let localRun = local.first(where: {
                $0.isActive && abs($0.startedAt.timeIntervalSince(panelRun.startedAt)) < 10
            }) {
                return localRun
            }
            return panelRun
        }

        // Add local-only runs not matched to any panel run
        let matchedStartTimes = Set(matched.filter { $0.isActive }.map { Int($0.startedAt.timeIntervalSince1970) })
        let localOnly = local.filter { localRun in
            !matched.contains(where: { $0.runId == localRun.runId }) &&
            !matchedStartTimes.contains(Int(localRun.startedAt.timeIntervalSince1970))
        }
        matched.insert(contentsOf: localOnly, at: 0)

        return matched
    }

    private func fetchFromPanel() async throws -> [Run]? {
        guard let panelClient = PanelClient.fromEnv(),
              let name = agentName else {
            return nil
        }
        let panelRuns = try await panelClient.fetchRuns(agent: name)
        return panelRuns.map { $0.toRun(agentId: agentId) }
    }

    private func fetchFromLocalServer() async throws -> [Run] {
        try await localClient.runsForAgent(id: agentId)
    }

    private func fetchLogsForRun(_ runId: String?) async {
        guard let runId, let panelClient = PanelClient.fromEnv() else {
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

    var body: some View {
        HStack(spacing: 10) {
            StatusIndicator(status: run.status)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(run.startedAt, style: .date)
                        .font(.system(.subheadline, weight: .medium))
                    Text(run.startedAt, style: .time)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 8) {
                    if run.conversationId != nil {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.caption)
                            .foregroundStyle(.purple)
                    }

                    if run.turnCount > 0 {
                        Label("\(run.turnCount) turns", systemImage: "arrow.trianglehead.2.counterclockwise")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    if let duration = run.duration {
                        Label(formatDuration(duration), systemImage: "clock")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    if let cost = run.estimatedCostUsd, cost > 0 {
                        Label(formatCost(cost), systemImage: "dollarsign.circle")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer()

            if run.status == .running {
                PulsingDot(color: .green)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Status indicator

struct StatusIndicator: View {
    let status: RunStatus

    private var color: Color {
        switch status {
        case .running: .orange
        case .completed: .green
        case .failed: .red
        case .skipped: .gray
        }
    }

    private var icon: String {
        switch status {
        case .running: "circle.fill"
        case .completed: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        case .skipped: "minus.circle.fill"
        }
    }

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 14))
            .foregroundStyle(color)
    }
}

// MARK: - Run detail view

struct RunDetailView: View {
    let run: Run
    let logs: [PanelLog]
    let onCancel: () -> Void
    @State private var now = Date()
    @State private var elapsedTimer: Timer?

    private var timelineEntries: [PanelLog] {
        logs.filter { !$0.isHeartbeat }
    }

    private var hasTimeline: Bool {
        !timelineEntries.isEmpty || !run.progressMessages.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                Divider()
                statsBar
                Divider()

                if run.status == .running {
                    liveIndicator
                    Divider()
                }

                if let error = run.error {
                    errorBanner(error)
                    Divider()
                }

                if let summary = run.summary, !summary.isEmpty {
                    summarySection(summary)
                    Divider()
                }

                if run.conversationId != nil {
                    conversationSection
                    Divider()
                }

                if hasTimeline {
                    activityTimeline
                    Divider()
                }

                detailSections
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .controlBackgroundColor))
        .onAppear { startElapsedTimer() }
        .onDisappear { stopElapsedTimer() }
        .onChange(of: run.status) { _, newStatus in
            if newStatus != .running { stopElapsedTimer() }
        }
    }

    private func startElapsedTimer() {
        guard run.status == .running else { return }
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in now = Date() }
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
    }

    private var liveElapsed: TimeInterval {
        now.timeIntervalSince(run.startedAt)
    }

    // MARK: - Live indicator

    private var liveIndicator: some View {
        HStack(spacing: 10) {
            PulsingDot(color: .green)

            Text("Running")
                .font(.system(.subheadline, weight: .medium))
                .foregroundStyle(.green)

            Text(formatDuration(liveElapsed))
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.secondary)

            Spacer()

            if run.turnCount > 0 {
                Text("Turn \(run.turnCount)")
                    .font(.system(.caption, design: .monospaced, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.green.opacity(0.04))
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(run.agentName)
                        .font(.system(.title3, weight: .semibold))

                    StatusBadge(status: run.status)
                }

                HStack(spacing: 10) {
                    Text("Run \(run.runId.prefix(8))")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .textSelection(.enabled)

                    if let model = run.model {
                        Text(model)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.purple.opacity(0.8))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.purple.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }

                    if let trigger = run.trigger {
                        Text(trigger)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            CopyRunButton(run: run, logs: logs, timelineEntries: timelineEntries)

            if run.status == .running {
                Button(role: .destructive) {
                    onCancel()
                } label: {
                    Label("Cancel", systemImage: "stop.circle")
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding(16)
    }

    // MARK: - Stats bar

    private var statsBar: some View {
        let items = buildStatItems()
        return HStack(spacing: 0) {
            ForEach(items.indices, id: \.self) { index in
                if index > 0 {
                    verticalDivider
                }
                statItem(
                    icon: items[index].icon,
                    label: items[index].label,
                    value: items[index].value
                )
            }
        }
        .padding(.vertical, 12)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
    }

    private struct StatItemData {
        let icon: String
        let label: String
        let value: String
    }

    private func buildStatItems() -> [StatItemData] {
        var items: [StatItemData] = []

        let durationValue = run.status == .running
            ? formatDuration(liveElapsed)
            : (run.duration.map(formatDuration) ?? "--")
        items.append(StatItemData(icon: "clock", label: "Duration", value: durationValue))

        items.append(StatItemData(
            icon: "arrow.trianglehead.2.counterclockwise",
            label: "Turns",
            value: "\(run.turnCount)"
        ))

        if let tokens = run.totalTokens, tokens > 0 {
            items.append(StatItemData(
                icon: "number",
                label: "Tokens",
                value: formatTokenCount(tokens)
            ))
        }

        if let cost = run.estimatedCostUsd, cost > 0 {
            items.append(StatItemData(
                icon: "dollarsign.circle",
                label: "Cost",
                value: formatCost(cost)
            ))
        }

        items.append(StatItemData(
            icon: "wrench",
            label: "Tools",
            value: "\(run.toolsUsed.count)"
        ))

        items.append(StatItemData(
            icon: "doc",
            label: "Files",
            value: "\(run.filesRead.count + run.filesWritten.count)"
        ))

        if !run.commandsRun.isEmpty {
            items.append(StatItemData(
                icon: "terminal",
                label: "Commands",
                value: "\(run.commandsRun.count)"
            ))
        }

        return items
    }

    private func statItem(icon: String, label: String, value: String) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(.body, design: .monospaced, weight: .semibold))
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
    }

    private var verticalDivider: some View {
        Rectangle()
            .fill(.quaternary)
            .frame(width: 1, height: 28)
    }

    // MARK: - Error banner

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(error)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.red)
                .textSelection(.enabled)
            Spacer()
            CopyTextButton(text: error, label: "Copy error")
        }
        .padding(12)
        .background(.red.opacity(0.08))
    }

    // MARK: - Summary

    private func summarySection(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionHeader(title: "Summary", icon: "text.alignleft")
                Spacer()
                CopyTextButton(text: summary, label: "Copy summary")
            }
            MarkdownContentView(source: summary)
        }
        .padding(16)
    }

    // MARK: - Conversation

    private var conversationSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: "Conversation", icon: "bubble.left.and.bubble.right")
            HStack(spacing: 6) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.caption)
                    .foregroundStyle(.purple)
                Text("Part of a conversation")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let convId = run.conversationId {
                    Text(convId.prefix(8))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(16)
    }

    // MARK: - Activity timeline

    private var timelineText: String {
        if !timelineEntries.isEmpty {
            return timelineEntries.map { "[\($0.level)] \($0.message)" }.joined(separator: "\n")
        }
        return run.progressMessages.joined(separator: "\n")
    }

    private var activityTimeline: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionHeader(title: "Activity", icon: "list.bullet")
                Spacer()
                CopyTextButton(text: timelineText, label: "Copy activity")
            }

            if !timelineEntries.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(timelineEntries.enumerated()), id: \.element.id) { index, log in
                        LogTimelineRow(
                            log: log,
                            isLast: index == timelineEntries.count - 1
                        )
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(run.progressMessages.enumerated()), id: \.offset) { index, message in
                        TimelineRow(message: message, isLast: index == run.progressMessages.count - 1)
                    }
                }
            }
        }
        .padding(16)
    }

    // MARK: - Detail sections

    private var detailSections: some View {
        VStack(alignment: .leading, spacing: 20) {
            if run.inputTokens != nil || run.outputTokens != nil {
                tokenBreakdown
            }

            if !run.toolsUsed.isEmpty {
                toolsSection
            }

            if !run.filesWritten.isEmpty {
                fileSection(title: "Files written", icon: "doc.badge.plus", files: run.filesWritten, color: .green)
            }

            if !run.filesRead.isEmpty {
                fileSection(title: "Files read", icon: "doc.text", files: run.filesRead, color: .secondary)
            }

            if !run.commandsRun.isEmpty {
                commandsSection
            }
        }
        .padding(16)
    }

    private var tokenBreakdown: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Token usage", icon: "number")

            HStack(spacing: 20) {
                if let input = run.inputTokens {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Input")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(formatTokenCount(input))
                            .font(.system(.subheadline, design: .monospaced, weight: .medium))
                            .foregroundStyle(.blue)
                    }
                }

                if let output = run.outputTokens {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Output")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(formatTokenCount(output))
                            .font(.system(.subheadline, design: .monospaced, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }

                if let total = run.totalTokens {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Total")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(formatTokenCount(total))
                            .font(.system(.subheadline, design: .monospaced, weight: .medium))
                    }
                }

                if let cost = run.estimatedCostUsd, cost > 0 {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Cost")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(formatCost(cost))
                            .font(.system(.subheadline, design: .monospaced, weight: .medium))
                            .foregroundStyle(.green)
                    }
                }
            }
        }
    }

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Tools used", icon: "wrench.and.screwdriver")

            FlowLayout(spacing: 6) {
                ForEach(run.toolsUsed, id: \.self) { tool in
                    ToolTag(name: tool)
                }
            }
        }
    }

    private func fileSection(title: String, icon: String, files: [String], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: title, icon: icon)

            VStack(alignment: .leading, spacing: 4) {
                ForEach(files, id: \.self) { file in
                    Text(abbreviatePath(file))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(color)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }

    private var commandsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Commands", icon: "terminal")

            VStack(alignment: .leading, spacing: 4) {
                ForEach(run.commandsRun, id: \.self) { command in
                    HStack(alignment: .top, spacing: 6) {
                        Text("$")
                            .font(.system(.caption, design: .monospaced, weight: .bold))
                            .foregroundStyle(.tertiary)
                        Text(command)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }
                }
            }
        }
    }
}

// MARK: - Supporting views

private struct StatusBadge: View {
    let status: RunStatus

    private var color: Color {
        switch status {
        case .running: .orange
        case .completed: .green
        case .failed: .red
        case .skipped: .gray
        }
    }

    private var label: String {
        switch status {
        case .running: "Running"
        case .completed: "Completed"
        case .failed: "Failed"
        case .skipped: "Skipped"
        }
    }

    var body: some View {
        Text(label)
            .font(.system(.caption, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

private struct SectionHeader: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(.secondary)
        }
    }
}

private struct LogTimelineRow: View {
    let log: PanelLog
    let isLast: Bool

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    private var isToolUse: Bool {
        log.message.hasPrefix("Using tool:")
    }

    private var displayMessage: String {
        if isToolUse {
            return String(log.message.dropFirst("Using tool: ".count))
        }
        return log.message
    }

    private var dotColor: Color {
        if isToolUse { return .purple }
        if log.level == "error" { return .red }
        return .secondary
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 0) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)

                if !isLast {
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 1)
                        .frame(minHeight: 16)
                }
            }
            .frame(width: 7)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if isToolUse {
                        Text(formatToolName(displayMessage))
                            .font(.system(.caption, design: .monospaced, weight: .medium))
                            .foregroundStyle(.purple)
                    } else {
                        Text(displayMessage)
                            .font(.caption)
                            .foregroundStyle(log.level == "error" ? .red : .secondary)
                            .lineLimit(3)
                    }

                    Spacer()

                    if let turns = log.turnsCompleted {
                        Text("T\(turns)")
                            .font(.system(.caption2, design: .monospaced, weight: .medium))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(.tertiary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }

                    Text(Self.timeFormatter.string(from: log.timestamp))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.quaternary)
                }
            }
            .padding(.bottom, isLast ? 0 : 8)
        }
    }
}

private struct TimelineRow: View {
    let message: String
    let isLast: Bool

    private var isToolUse: Bool {
        message.hasPrefix("Using tool:")
    }

    private var displayMessage: String {
        if isToolUse {
            return String(message.dropFirst("Using tool: ".count))
        }
        return message
    }

    private var dotColor: Color {
        isToolUse ? .purple : .secondary
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 0) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)

                if !isLast {
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 1)
                        .frame(minHeight: 16)
                }
            }
            .frame(width: 7)

            VStack(alignment: .leading, spacing: 2) {
                if isToolUse {
                    Text(formatToolName(displayMessage))
                        .font(.system(.caption, design: .monospaced, weight: .medium))
                        .foregroundStyle(.purple)
                } else {
                    Text(displayMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
            .padding(.bottom, isLast ? 0 : 8)
        }
    }
}

private struct ToolTag: View {
    let name: String

    private var displayName: String {
        formatToolName(name)
    }

    private var tagColor: Color {
        if name.hasPrefix("mcp__") { return .purple }
        if name == "Bash" { return .orange }
        if name == "Read" || name == "Grep" || name == "Glob" { return .blue }
        if name == "Write" || name == "Edit" { return .green }
        return .secondary
    }

    var body: some View {
        Text(displayName)
            .font(.system(.caption2, design: .monospaced, weight: .medium))
            .foregroundStyle(tagColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tagColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

// MARK: - Flow layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalHeight = y + rowHeight
        }

        return (CGSize(width: maxWidth, height: totalHeight), positions)
    }
}

// MARK: - Helpers

private func formatToolName(_ name: String) -> String {
    if name.hasPrefix("mcp__") {
        let parts = name.dropFirst(5).split(separator: "__", maxSplits: 1)
        if parts.count == 2 {
            let server = parts[0].split(separator: "_").dropFirst().joined(separator: " ")
            let tool = parts[1].replacingOccurrences(of: "_", with: " ")
            return "\(server): \(tool)"
        }
    }
    return name
}

private func formatDuration(_ interval: TimeInterval) -> String {
    let totalSeconds = Int(interval)
    if totalSeconds < 60 {
        return "\(totalSeconds)s"
    }
    let minutes = totalSeconds / 60
    let seconds = totalSeconds % 60
    if minutes < 60 {
        return "\(minutes)m \(seconds)s"
    }
    let hours = minutes / 60
    let remainingMinutes = minutes % 60
    return "\(hours)h \(remainingMinutes)m"
}

private func formatTokenCount(_ count: Int) -> String {
    if count >= 1_000_000 {
        return String(format: "%.1fM", Double(count) / 1_000_000)
    }
    if count >= 1_000 {
        return String(format: "%.1fk", Double(count) / 1_000)
    }
    return "\(count)"
}

private func formatCost(_ cost: Double) -> String {
    if cost < 0.01 {
        return String(format: "$%.4f", cost)
    }
    return String(format: "$%.2f", cost)
}

private func abbreviatePath(_ path: String) -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    if path.hasPrefix(home) {
        return "~" + path.dropFirst(home.count)
    }
    return path
}

// MARK: - Copy components

private struct CopyTextButton: View {
    let text: String
    let label: String
    @State private var copied = false

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
        } label: {
            Label(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(.caption2)
                .foregroundStyle(copied ? .green : .secondary)
        }
        .buttonStyle(.plain)
    }
}

private struct CopyRunButton: View {
    let run: Run
    let logs: [PanelLog]
    let timelineEntries: [PanelLog]
    @State private var copied = false

    private var clipboardText: String {
        var sections: [String] = []

        sections.append("Agent: \(run.agentName)")
        sections.append("Run ID: \(run.runId)")
        sections.append("Status: \(run.status.rawValue)")
        if let model = run.model { sections.append("Model: \(model)") }
        if let trigger = run.trigger { sections.append("Trigger: \(trigger)") }
        sections.append("Started: \(run.startedAt)")
        if let completed = run.completedAt { sections.append("Completed: \(completed)") }
        if let duration = run.duration { sections.append("Duration: \(formatDuration(duration))") }
        sections.append("Turns: \(run.turnCount)")

        if let tokens = run.totalTokens { sections.append("Tokens: \(tokens)") }
        if let cost = run.estimatedCostUsd { sections.append("Cost: \(formatCost(cost))") }

        if let error = run.error {
            sections.append("\n--- Error ---")
            sections.append(error)
        }

        if let summary = run.summary, !summary.isEmpty {
            sections.append("\n--- Summary ---")
            sections.append(summary)
        }

        if !run.toolsUsed.isEmpty {
            sections.append("\n--- Tools (\(run.toolsUsed.count)) ---")
            sections.append(contentsOf: run.toolsUsed.map { "  \(formatToolName($0))" })
        }

        if !run.filesWritten.isEmpty {
            sections.append("\n--- Files written ---")
            sections.append(contentsOf: run.filesWritten.map { "  \($0)" })
        }

        if !run.filesRead.isEmpty {
            sections.append("\n--- Files read ---")
            sections.append(contentsOf: run.filesRead.map { "  \($0)" })
        }

        if !run.commandsRun.isEmpty {
            sections.append("\n--- Commands ---")
            sections.append(contentsOf: run.commandsRun.map { "  $ \($0)" })
        }

        if !timelineEntries.isEmpty {
            sections.append("\n--- Activity (\(timelineEntries.count) events) ---")
            sections.append(contentsOf: timelineEntries.map { "[\($0.level)] \($0.message)" })
        } else if !run.progressMessages.isEmpty {
            sections.append("\n--- Activity (\(run.progressMessages.count) events) ---")
            sections.append(contentsOf: run.progressMessages)
        }

        return sections.joined(separator: "\n")
    }

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(clipboardText, forType: .string)
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
        } label: {
            Label(copied ? "Copied" : "Copy all", systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(.caption)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}
