import SwiftUI
import AgentServerDesignSystem

/// The sidebar and main-pane footers sit side by side along the bottom of the
/// window, so their dividers read as one continuous line. Both panes size their
/// footer from here rather than from their own content, which would otherwise
/// drift apart as the content in either one changes.
enum WindowFooterMetrics {
    static let height = CGFloat(CreationRequestEditorPresentation.footerHeight)
    static let dividerOpacity: Double = 0.4
}

/// Consumer home backed by the server-owned Today and Activity snapshot.
struct MainPane: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme
    @State private var destination = MainDestination.defaultDestination
    @State private var presentedInteraction: PresentedInteraction?
    @State private var loadingActionReference: String?
    @State private var interactionLoadError: String?

    private let client = AgentServerClient()

    var body: some View {
        VStack(spacing: 0) {
            MainPaneDestinationBar(selection: $destination)
            destinationContent
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
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
                    monitor.poll()
                }
            )
        }
        .alert(
            "Could not open this request",
            isPresented: Binding(
                get: { interactionLoadError != nil },
                set: { if !$0 { interactionLoadError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(interactionLoadError ?? "Try again.")
        }
        .onChange(of: destination) { _, selectedDestination in
            guard selectedDestination == .connections else { return }
            router.openConnections()
            destination = .today
        }
    }

    @ViewBuilder
    private var destinationContent: some View {
        if let snapshot = monitor.todayActivitySnapshot {
            switch destination {
            case .today:
                TodayView(
                    presentation: snapshot.makeTodayPresentation(),
                    loadingActionReference: loadingActionReference,
                    onAction: handleTodayAction
                )
            case .activity:
                ActivityView(
                    items: snapshot.makeActivityPresentation(filter: .all).items,
                    onOpen: openActivity
                )
            case .assistants, .connections, .settings:
                EmptyView()
            }
        } else {
            snapshotUnavailable
        }
    }

    private var snapshotUnavailable: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: monitor.isServerReachable ? "clock" : "bolt.horizontal.circle")
                .font(.system(size: 28))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(monitor.isServerReachable ? "Preparing Today" : "Agent Server is offline")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text(
                monitor.isServerReachable
                    ? "Your latest assistant activity will appear here."
                    : "Your assistants stay on this Mac and will appear when the local server returns."
            )
            .font(NTypography.bodyMedium)
            .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("today.unavailable")
    }

    private func handleTodayAction(_ item: TodayItem, _ action: PresentationAction) {
        let reference = action.targetReference
        if action.kind == .respond,
           let interactionID = reference.removingPrefix("interaction:") {
            loadInteraction(id: interactionID, reference: reference)
            return
        }
        if let assistantID = reference.removingPrefix("assistant:") {
            router.openDetail(agentId: assistantID)
            return
        }
        guard let runID = reference.removingPrefix("run:") else { return }
        openRun(runID)
    }

    private func loadInteraction(id: String, reference: String) {
        guard loadingActionReference == nil else { return }
        loadingActionReference = reference
        interactionLoadError = nil
        Task {
            defer { loadingActionReference = nil }
            do {
                let interaction = try await client.interaction(id: id)
                guard interaction.status.canRespond else {
                    interactionLoadError = "This request is no longer waiting for a response."
                    monitor.poll()
                    return
                }
                presentedInteraction = PresentedInteraction(interaction: interaction)
            } catch {
                interactionLoadError = error.localizedDescription
            }
        }
    }

    private func openActivity(_ item: ActivityItem) {
        router.openRun(agentId: item.assistantID, runId: item.runID)
    }

    private func openRun(_ runID: String) {
        if let item = monitor.todayActivitySnapshot?
            .makeActivityPresentation(filter: .all)
            .items
            .first(where: { $0.runID == runID }) {
            router.openRun(agentId: item.assistantID, runId: runID)
            return
        }
        guard let run = monitor.recentRuns.first(where: { $0.runId == runID }) else { return }
        router.openRun(agentId: run.agentId, runId: runID)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: NSpacing.sm) {
            Spacer()

            ForEach(MainFooterUtilityDestination.allCases, id: \.self) { destination in
                Button { destination.open(using: router) } label: {
                    FooterUtilityIcon(destination: destination)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(destination.help)
                .accessibilityLabel(destination.title)
                .accessibilityIdentifier(destination.accessibilityIdentifier)
            }
        }
        .padding(.horizontal, NSpacing.lg)
        .frame(height: WindowFooterMetrics.height)
        .overlay(alignment: .top) { Divider().opacity(WindowFooterMetrics.dividerOpacity) }
    }

}

private struct PresentedInteraction: Identifiable {
    let interaction: LocalInteraction
    var id: String { interaction.interactionID }
}

private struct FooterUtilityIcon: View {
    let destination: MainFooterUtilityDestination

    @Environment(\.nTheme) private var theme

    var body: some View {
        Label(destination.title, systemImage: destination.systemImage)
            .labelStyle(.iconOnly)
            .font(NTypography.caption)
            .foregroundStyle(theme.tokens.mutedForeground)
    }
}
