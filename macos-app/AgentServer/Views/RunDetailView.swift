import SwiftUI
import NerdsUI

struct RunDetailView: View {
    let run: Run
    let logs: [PanelLog]
    let onCancel: () -> Void
    var onDelete: (() -> Void)? = nil
    var onDebug: (() -> Void)? = nil
    var decisions: [Decision] = []

    @Environment(\.nTheme) private var theme
    @State private var selectedTab: RunDetailTabKind = .activity
    @FocusState private var focusedTab: RunDetailTabKind?

    private var runDecisionsViewModel: RunDecisionsViewModel {
        RunDecisionsViewModel(runId: run.runId, decisions: decisions)
    }
    @State private var now = Date()
    @State private var elapsedTimer: Timer?

    private var liveElapsed: TimeInterval {
        now.timeIntervalSince(run.startedAt)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            statsBar
            Divider()

            if run.status == .running {
                liveIndicator
                Divider()
            }

            if let error = run.error {
                runNoticeBanner(
                    RunNoticePresentation(
                        status: run.status.rawValue,
                        code: run.code,
                        technicalMessage: error
                    ),
                    technicalDetails: error
                )
                Divider()
            }

            contentArea
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { startElapsedTimer() }
        .onDisappear { stopElapsedTimer() }
        .onChange(of: run.status) { _, newStatus in
            if newStatus != .running { stopElapsedTimer() }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: NSpacing.md) {
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                HStack(spacing: NSpacing.sm) {
                    Text(run.agentName)
                        .font(NTypography.titleLarge)
                        .fontWeight(.semibold)
                    StatusBadge(status: run.status)
                }

                HStack(spacing: NSpacing.md) {
                    Text("Run \(run.runId.prefix(8))")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.tokens.mutedForeground.opacity(0.6))
                        .textSelection(.enabled)

                    if let model = run.model {
                        Text(model)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.purple.opacity(0.8))
                            .padding(.horizontal, NSpacing.xs)
                            .padding(.vertical, NSpacing.xxxs)
                            .background(.purple.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
                    }

                    if let trigger = run.trigger {
                        Text(trigger)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                }
            }

            Spacer()

            CopyRunButton(run: run, logs: logs)

            if run.status == .failed, let onDebug {
                Button(action: onDebug) {
                    Label("What went wrong?", systemImage: "stethoscope")
                        .font(NTypography.bodySmall)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .accessibilityIdentifier(ConsumerFlowAccessibility.debuggerOpen)
            }

            if run.status == .running {
                Button(role: .destructive) {
                    onCancel()
                } label: {
                    Label("Cancel", systemImage: "stop.circle")
                        .font(NTypography.bodySmall)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding(NSpacing.lg)
    }

    // MARK: - Stats bar

    private var statsBar: some View {
        HStack(spacing: 0) {
            let items = buildStatItems()
            ForEach(items.indices, id: \.self) { index in
                if index > 0 {
                    Rectangle().fill(.quaternary).frame(width: 1, height: 28)
                }
                statCell(icon: items[index].icon, label: items[index].label, value: items[index].value, tooltip: items[index].tooltip)
            }
        }
        .padding(.vertical, NSpacing.md)
    }

    private func statCell(icon: String, label: String, value: String, tooltip: String?) -> some View {
        VStack(spacing: NSpacing.xxxs) {
            HStack(spacing: NSpacing.xxs) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(.body, design: .monospaced, weight: .semibold))
            }
            HStack(spacing: NSpacing.xxs) {
                Text(label)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                if let tooltip {
                    InfoTooltip(text: tooltip)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private struct StatItem {
        let icon: String
        let label: String
        let value: String
        var tooltip: String? = nil
    }

    private var heartbeatCountDisplay: String {
        guard !logs.isEmpty else { return "--" }
        return "\(logs.filter { $0.isHeartbeat }.count)"
    }

    private func buildStatItems() -> [StatItem] {
        let durationValue = run.status == .running
            ? formatDuration(liveElapsed)
            : (run.duration.map(formatDuration) ?? "--")
        return [
            StatItem(icon: "clock", label: "Duration", value: durationValue),
            StatItem(icon: "arrow.trianglehead.2.counterclockwise", label: "Turns", value: "\(run.turnCount)"),
            StatItem(icon: "wrench", label: "Tools", value: "\(run.toolsUsed.count)"),
            StatItem(icon: "waveform.path.ecg", label: "Heartbeats", value: heartbeatCountDisplay),
        ]
    }

    // MARK: - Live indicator

    private var liveIndicator: some View {
        HStack(spacing: NSpacing.md) {
            PulsingDot(color: .green)

            Text("Running")
                .font(NTypography.labelMedium)
                .foregroundStyle(.green)

            Text(formatDuration(liveElapsed))
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(theme.tokens.mutedForeground)

            Spacer()

            if run.turnCount > 0 {
                Text("Turn \(run.turnCount)")
                    .font(.system(.caption, design: .monospaced, weight: .medium))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.horizontal, NSpacing.sm)
                    .padding(.vertical, NSpacing.xxxs)
                    .background(theme.tokens.muted)
                    .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
            }
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
        .background(.green.opacity(0.04))
    }

    private func runNoticeBanner(
        _ presentation: RunNoticePresentation,
        technicalDetails: String
    ) -> some View {
        let isError = presentation.kind == .error
        let color: Color = isError ? .red : theme.tokens.mutedForeground

        return HStack(spacing: NSpacing.md) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(presentation.title)
                    .font(NTypography.labelMedium)
                    .foregroundStyle(color)
                Text(presentation.message)
                    .font(isError ? .system(.subheadline, design: .monospaced) : NTypography.bodySmall)
                    .foregroundStyle(color)
                    .textSelection(.enabled)
            }
            Spacer()
            CopyTextButton(text: technicalDetails, label: "Copy")
        }
        .padding(NSpacing.md)
        .background(isError ? Color.red.opacity(0.08) : theme.tokens.muted.opacity(0.5))
        .accessibilityElement(children: .combine)
    }

    // MARK: - Content: tabs

    private var contentArea: some View {
        VStack(spacing: 0) {
            tabPicker
            Divider()
            tabContent
        }
    }

    private var visibleTabs: [RunDetailTabKind] {
        RunDetailTabKind.allCases.filter { tab in
            if tab == .decisions && runDecisionsViewModel.isEmpty { return false }
            return true
        }
    }

    private var tabPicker: some View {
        HStack(spacing: NSpacing.xxs) {
            ForEach(visibleTabs, id: \.self) { tab in
                Button {
                    selectedTab = tab
                    focusedTab = tab
                } label: {
                    Text(tab.title)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(selectedTab == tab ? theme.tokens.foreground : theme.tokens.mutedForeground)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .background(selectedTab == tab ? theme.tokens.muted : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                .buttonStyle(.plain)
                .focused($focusedTab, equals: tab)
                .accessibilityLabel("\(tab.title) tab")
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityIdentifier("runDetail.tab.\(tab.rawValue)")
            }
            Spacer()
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
        .onMoveCommand(perform: moveTabSelection)
    }

    private func moveTabSelection(_ direction: MoveCommandDirection) {
        let moveDirection: RunDetailTabMoveDirection
        switch direction {
        case .left:
            moveDirection = .previous
        case .right:
            moveDirection = .next
        default:
            return
        }

        let nextTab = RunDetailTabNavigation.move(
            from: selectedTab,
            direction: moveDirection,
            available: visibleTabs
        )
        selectedTab = nextTab
        focusedTab = nextTab
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .activity:
            ActivityTabView(run: run, logs: logs)
        case .logs:
            LogsTabView(logs: logs, isLive: run.status == .running)
        case .decisions:
            RunDecisionsTabView(viewModel: runDecisionsViewModel)
        case .information:
            InformationTabView(run: run, onCancel: onCancel, onDelete: onDelete)
        }
    }

    // MARK: - Timer

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
}

// MARK: - Copy run button

private struct CopyRunButton: View {
    let run: Run
    let logs: [PanelLog]
    @State private var copied = false

    private var timelineEntries: [PanelLog] {
        logs.filter { !$0.isHeartbeat }
    }

    private var clipboardText: String {
        var s: [String] = []
        s.append("Agent: \(run.agentName)")
        s.append("Run ID: \(run.runId)")
        s.append("Status: \(run.status.rawValue)")
        if let model = run.model { s.append("Model: \(model)") }
        if let trigger = run.trigger { s.append("Trigger: \(trigger)") }
        s.append("Started: \(run.startedAt)")
        if let completed = run.completedAt { s.append("Completed: \(completed)") }
        if let duration = run.duration { s.append("Duration: \(formatDuration(duration))") }
        s.append("Turns: \(run.turnCount)")
        if let tokens = run.totalTokens { s.append("Tokens: \(tokens)") }
        if let cost = run.estimatedCostUsd { s.append("Cost: \(formatCost(cost))") }
        if let error = run.error { s.append("\n--- Error ---\n\(error)") }
        if let summary = run.summary, !summary.isEmpty { s.append("\n--- Summary ---\n\(summary)") }
        if !run.toolsUsed.isEmpty {
            s.append("\n--- Tools (\(run.toolsUsed.count)) ---")
            s.append(contentsOf: run.toolsUsed.map { "  \(formatToolName($0))" })
        }
        if !run.filesWritten.isEmpty {
            s.append("\n--- Files written ---")
            s.append(contentsOf: run.filesWritten)
        }
        if !timelineEntries.isEmpty {
            s.append("\n--- Activity (\(timelineEntries.count) events) ---")
            s.append(contentsOf: timelineEntries.map { "[\($0.level)] \($0.message)" })
        }
        return s.joined(separator: "\n")
    }

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(clipboardText, forType: .string)
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
        } label: {
            Label(copied ? "Copied" : "Copy all", systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(NTypography.caption)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}
