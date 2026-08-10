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

/// The main pane is the agent history, full stop. Security, Connections, and
/// Settings live as icons in the footer; agent detail slides over as a drawer.
struct MainPane: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            content
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
    }

    @ViewBuilder
    private var content: some View {
        if let snapshot = monitor.todayActivitySnapshot {
            ActivityView(
                items: snapshot.makeActivityPresentation(filter: .all).items,
                onOpen: openActivity
            )
        } else {
            snapshotUnavailable
        }
    }

    private var snapshotUnavailable: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: monitor.isServerReachable ? "clock" : "bolt.horizontal.circle")
                .font(.system(size: 28))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(monitor.isServerReachable ? "Preparing agent history" : "Agent Server is offline")
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text(
                monitor.isServerReachable
                    ? "Your latest agent activity will appear here."
                    : "Your agents stay on this Mac and will appear when the local server returns."
            )
            .font(NTypography.bodyMedium)
            .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("today.unavailable")
    }

    private func openActivity(_ item: ActivityItem) {
        router.openRun(agentId: item.assistantID, runId: item.runID)
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
