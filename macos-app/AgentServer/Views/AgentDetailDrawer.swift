import SwiftUI
import AgentServerDesignSystem
import AppKit

/// Slide-in drawer that overlays the main pane from the left edge of the main
/// area (x=240). Width 780, full remaining height. Consumer-focused agent
/// page: schedule in plain English, the last run's outcome, editing, and run
/// history. One tab bar swaps those surfaces without opening nested drawers.
struct AgentDetailDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0
    @State private var detailState: AgentDetailPresentationState
    @State private var runState = AgentRunTriggerState.idle
    @State private var homeContract: AssistantHomeContract?
    @State private var isLoadingHome = false
    @State private var homeError: String?
    @State private var isPerformingHomeAction = false
    @State private var presentedInteraction: AgentHomePresentedInteraction?

    private let client = AgentServerClient()

    static let width: CGFloat = 780
    static let slideDuration: Double = 0.22
    static let dismissThreshold: CGFloat = 80

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    init(monitor: StatusMonitor, router: DrawerRouter, agentId: String) {
        self.monitor = monitor
        self.router = router
        self.agentId = agentId
        var initialState = AgentDetailPresentationState(agentId: agentId)
        if let requestedRun = router.requestedRun,
           requestedRun.agentId == agentId {
            initialState.openRun(id: requestedRun.runId)
        }
        _detailState = State(initialValue: initialState)
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            VStack(spacing: 0) {
                header
                Divider().opacity(0.3)
                tabBar
                Divider().opacity(0.3)
                content
            }
            grabBar
        }
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(theme.tokens.background)
        .overlay(leadingBorder, alignment: .leading)
        // Rasterize the whole drawer as one layer BEFORE the shadow. Without
        // this, SwiftUI draws the shadow per opaque subview inside the
        // drawer, producing visible inner drop-shadows that shouldn't be there.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 20, x: -8, y: 0)
        .offset(x: dragOffset)
        .task(id: agentId) {
            await loadAssistantHome()
        }
        .sheet(item: $presentedInteraction) { presented in
            InteractionResponseSheet(
                interaction: presented.interaction,
                submit: { reply in
                    try await client.replyToInteraction(
                        id: presented.interaction.interactionID,
                        reply: reply
                    )
                },
                onAccepted: { _ in
                    presentedInteraction = nil
                    Task { await loadAssistantHome() }
                    monitor.poll()
                }
            )
        }
        .onChange(of: agentId) { _, selectedAgentId in
            detailState.selectAgent(id: selectedAgentId)
            runState = .idle
            homeContract = nil
            homeError = nil
        }
        .onChange(of: router.requestedRun) { _, requestedRun in
            guard requestedRun?.agentId == agentId,
                  let runId = requestedRun?.runId else { return }
            detailState.openRun(id: runId)
        }
        .onExitCommand(perform: router.close)
    }

    /// Vertical 4pt grab bar glued to the right edge. Dragging it leftward
    /// follows the drawer; release past `dismissThreshold` closes.
    private var grabBar: some View {
        ZStack {
            Rectangle()
                .fill(theme.tokens.border.opacity(0.5))
                .frame(width: 4)
                .frame(maxHeight: .infinity)

            // Three stacked dots as an affordance so the bar reads as a handle.
            VStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle()
                        .fill(theme.tokens.mutedForeground.opacity(0.6))
                        .frame(width: 3, height: 3)
                }
            }
        }
        .frame(width: 12)
        .contentShape(Rectangle())
        .onHover { inside in
            if inside {
                NSCursor.resizeLeftRight.push()
            } else {
                NSCursor.pop()
            }
        }
        .gesture(grabBarDragGesture)
    }

    private var grabBarDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                // Clamp: only allow leftward movement, bounded by drawer width.
                let raw = value.translation.width
                dragOffset = max(-Self.width, min(0, raw))
            }
            .onEnded { value in
                let translation = value.translation.width
                if shouldDismissOnRelease(
                    translation: translation,
                    threshold: Self.dismissThreshold,
                    axis: .horizontalLeading
                ) {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: Self.slideDuration)) {
                        dragOffset = -Self.width
                    }
                    router.close()
                } else {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                        dragOffset = 0
                    }
                }
            }
    }

    private var leadingBorder: some View {
        Rectangle()
            .fill(theme.tokens.border)
            .frame(width: 1)
    }

    // MARK: - Header

    private var header: some View {
        AgentDetailHeader(
            name: agent?.name ?? agentId,
            description: agent?.description,
            schedule: agent?.scheduleDisplay,
            nextRun: nextRunDescription,
            run: headerRunPresentation,
            security: securityIndicator,
            showsActions: detailState.showsHeaderActions,
            onClose: router.close,
            onRun: startRun,
            onSecurity: { router.openSecurity(agentId: agentId) }
        )
    }

    private var nextRunDescription: String? {
        guard let schedule = agent?.schedule,
              let next = CronNextFire.next(schedule, after: Date()) else {
            return nil
        }
        return next.formatted(.relative(presentation: .numeric))
    }

    private var tabBar: some View {
        AgentDetailTabBar(
            selectedTab: detailState.selectedTab,
            onSelect: selectTab
        )
    }

    private func selectTab(_ tab: AgentDetailTab) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.16)) {
            detailState.select(tab)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if agent != nil {
            switch detailState.selectedTab {
            case .recentRuns:
                assistantHomeView
            case .editAgent:
                AgentSettingsSheet(
                    monitor: monitor,
                    agentId: agentId,
                    isPresented: .constant(true),
                    isEmbedded: true,
                    onFinished: { selectTab(.recentRuns) },
                    onDeleted: { router.close() }
                )
                .id(agentId)
            case .runHistory:
                AgentRunsView(
                    agentId: agentId,
                    monitor: monitor,
                    initiallySelectedRunId: detailState.selectedRunId
                )
                .id("\(agentId):\(detailState.selectedRunId ?? "latest")")
            }
        } else {
            Text("Agent not found.")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var assistantHomeView: some View {
        Group {
            if let homeContract {
                AssistantHomeView(
                    presentation: AssistantHomePresentation(contract: homeContract),
                    showsIdentity: false,
                    isPerformingAction: isPerformingHomeAction,
                    onPrimaryAction: performHomeAction,
                    onSecondaryAction: performHomeAction,
                    onOpenRun: { detailState.openRun(id: $0.runId) }
                )
            } else if isLoadingHome {
                ProgressView("Checking readiness")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView(
                    "Could not load this assistant",
                    systemImage: "exclamationmark.circle",
                    description: Text(homeError ?? "Try again.")
                )
                Button("Try again") {
                    Task { await loadAssistantHome() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var missingConnectionCount: Int {
        (agent?.capabilities ?? []).count { capability in
            guard capability.enabled else { return false }
            let isMissingRequiredEnvironment = !capability.requiredEnv.isEmpty
                && !capability.envReady
            return isMissingRequiredEnvironment
                || capability.status == "needs-auth"
                || capability.status == "failed"
        }
    }

    private var securityIndicator: AgentDetailSecurityIndicatorPresentation {
        let result = monitor.securityDashboard?.agents.first(where: { $0.id == agentId })?.result
            ?? .pending
        return AgentDetailSecurityIndicatorPresentation(
            result: result,
            missingConnectionCount: missingConnectionCount
        )
    }

    private var isRunning: Bool {
        if runState.isStarting { return true }
        if monitor.activeRuns.contains(where: { $0.agentId == agentId }) { return true }
        guard let startedRunId = runState.startedRunId else { return false }
        return !monitor.recentRuns.contains { run in
            run.runId == startedRunId && run.status != .running
        }
    }

    private var headerRunPresentation: AgentDetailHeaderRunPresentation {
        AgentDetailHeaderRunPresentation(
            isAgentEnabled: agent?.enabled ?? false,
            isRunning: isRunning
        )
    }

    private func startRun() {
        guard let agent, !headerRunPresentation.isDisabled else { return }
        runState = .starting
        isPerformingHomeAction = true
        Task {
            runState = await monitor.triggerRun(agentId: agent.id)
            await loadAssistantHome()
            isPerformingHomeAction = false
        }
    }

    private func loadAssistantHome() async {
        let requestedAgentID = agentId
        isLoadingHome = homeContract == nil
        homeError = nil
        do {
            let contract = try await client.assistantHome(id: requestedAgentID)
            guard requestedAgentID == agentId, !Task.isCancelled else { return }
            homeContract = contract
        } catch {
            guard requestedAgentID == agentId, !Task.isCancelled else { return }
            homeError = error.localizedDescription
        }
        isLoadingHome = false
    }

    private func performHomeAction(_ action: PresentationAction) {
        guard !isPerformingHomeAction else { return }
        switch action.kind {
        case .run:
            startRun()
        case .pause:
            updateEnabled(false)
        case .edit, .advanced:
            selectTab(.editAgent)
        case .viewActivity, .review:
            if let runID = action.targetReference.removingPrefix("run:") {
                detailState.openRun(id: runID)
            }
        case .resolveAttention, .respond:
            openInteraction(from: action.targetReference)
        case .safeTest:
            startSafeTest()
        case .viewAssistant, .unknown:
            break
        }
    }

    private func updateEnabled(_ isEnabled: Bool) {
        isPerformingHomeAction = true
        Task {
            _ = await monitor.updateAgent(id: agentId, patch: ["enabled": isEnabled])
            await loadAssistantHome()
            isPerformingHomeAction = false
        }
    }

    private func startSafeTest() {
        isPerformingHomeAction = true
        Task {
            defer { isPerformingHomeAction = false }
            do {
                let response = try await client.triggerSafeTest(agentId: agentId)
                detailState.openRun(id: response.runId)
                monitor.poll()
            } catch {
                homeError = error.localizedDescription
            }
        }
    }

    private func openInteraction(from reference: String) {
        guard let interactionID = reference.removingPrefix("interaction:") else { return }
        isPerformingHomeAction = true
        Task {
            defer { isPerformingHomeAction = false }
            do {
                let interaction = try await client.interaction(id: interactionID)
                guard interaction.status.canRespond else {
                    await loadAssistantHome()
                    return
                }
                presentedInteraction = AgentHomePresentedInteraction(interaction: interaction)
            } catch {
                homeError = error.localizedDescription
            }
        }
    }
}

private struct AgentHomePresentedInteraction: Identifiable {
    let interaction: LocalInteraction
    var id: String { interaction.interactionID }
}
