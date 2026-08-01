import SwiftUI
import AgentServerDesignSystem

struct RunDetailView: View {
    let run: Run
    let logs: [PanelLog]
    let onCancel: () -> Void
    var onDelete: (() -> Void)? = nil
    var onDebug: (() -> Void)? = nil
    var decisions: [Decision] = []

    @Environment(\.nTheme) private var theme
    @State private var selectedTab: RunDetailTabKind = .activity
    @State private var showsNoticeDetails = false
    @State private var showsTechnicalDetails = false
    @State private var reviewLoadState: ReviewLoadState = .loading
    @FocusState private var focusedTab: RunDetailTabKind?

    private let localClient = AgentServerClient()

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
            if showsHeaderActions {
                headerActions
                Divider()
            }
            reviewContent
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { startElapsedTimer() }
        .onDisappear { stopElapsedTimer() }
        .onChange(of: run.status) { _, newStatus in
            if newStatus != .running { stopElapsedTimer() }
        }
        .task(id: "\(run.runId):\(run.status.rawValue)") {
            await loadReview()
        }
    }

    @ViewBuilder
    private var reviewContent: some View {
        switch reviewLoadState {
        case .loading:
            ConsumerProgressView(
                title: "Preparing your review",
                message: "Summarizing what happened and what needs attention."
            )
        case .loaded(let review):
            if showsTechnicalDetails {
                technicalContent
            } else {
                RunReviewSummaryView(review: review)
            }
        case .unavailable:
            VStack(spacing: 0) {
                reviewUnavailableBanner
                Divider()
                technicalContent
            }
        }
    }

    private var technicalContent: some View {
        VStack(spacing: 0) {
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
    }

    // MARK: - Header actions

    private var showsHeaderActions: Bool {
        if case .loaded = reviewLoadState { return true }
        return run.status == .running || (run.status == .failed && onDebug != nil)
    }

    private var headerActions: some View {
        HStack(spacing: NSpacing.md) {
            Spacer()

            if case .loaded = reviewLoadState {
                Button {
                    showsTechnicalDetails.toggle()
                } label: {
                    Label(
                        showsTechnicalDetails ? "Review" : "Technical details",
                        systemImage: showsTechnicalDetails ? "doc.text" : "wrench.and.screwdriver"
                    )
                    .font(NTypography.bodySmall)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityIdentifier("runReview.technicalDetails")
            }

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

    private var reviewUnavailableBanner: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: "info.circle")
                .foregroundStyle(theme.tokens.mutedForeground)
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text("Review unavailable")
                    .font(NTypography.labelMedium)
                Text("Technical details are still available.")
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            Spacer()
            Button("Try again") {
                Task { await loadReview() }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(NSpacing.md)
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

    private func buildStatItems() -> [StatItem] {
        let durationValue = run.status == .running
            ? formatDuration(liveElapsed)
            : (run.duration.map(formatDuration) ?? "--")
        return [
            StatItem(icon: "clock", label: "Duration", value: durationValue),
            StatItem(icon: "arrow.trianglehead.2.counterclockwise", label: "Turns", value: "\(run.turnCount)"),
            StatItem(icon: "wrench", label: "Tools", value: "\(run.toolsUsed.count)"),
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
    }

    private func runNoticeBanner(
        _ presentation: RunNoticePresentation,
        technicalDetails: String
    ) -> some View {
        let isError = presentation.kind == .error
        let color: Color = isError ? .red : theme.tokens.mutedForeground

        return VStack(alignment: .leading, spacing: NSpacing.sm) {
            HStack(alignment: .top, spacing: NSpacing.md) {
                Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                    .foregroundStyle(color)
                VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                    Text(presentation.title)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    Text(presentation.message)
                        .font(noticeSummaryFont(presentation.summaryTextStyle))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .textSelection(.enabled)
                }
                Spacer()
                if presentation.disclosesTechnicalDetails {
                    Button(showsNoticeDetails ? "Hide details" : "Details") {
                        showsNoticeDetails.toggle()
                    }
                    .buttonStyle(.plain)
                    .font(NTypography.caption)
                }
            }
            if showsNoticeDetails {
                HStack(alignment: .top, spacing: NSpacing.sm) {
                    Text(technicalDetails)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .textSelection(.enabled)
                    Spacer()
                    CopyTextButton(text: technicalDetails, label: "Copy")
                }
            }
        }
        .padding(NSpacing.md)
        .accessibilityElement(children: .combine)
    }

    private func noticeSummaryFont(_ style: RunNoticeSummaryTextStyle) -> Font {
        switch style {
        case .body: NTypography.bodySmall
        }
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

    @MainActor
    private func loadReview() async {
        reviewLoadState = .loading
        do {
            reviewLoadState = .loaded(try await localClient.runReview(id: run.runId))
        } catch {
            reviewLoadState = .unavailable
        }
    }
}

private enum ReviewLoadState {
    case loading
    case loaded(RunReview)
    case unavailable
}
