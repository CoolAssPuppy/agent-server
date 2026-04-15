import SwiftUI
import NerdsUI
import AppKit

/// Slide-in drawer that overlays the main pane from the left edge of the main
/// area (x=240). Width 780, full remaining height. Contains `Definition` and
/// `Runs` tabs condensed from the existing AgentDetail views.
struct AgentDetailDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter
    let agentId: String

    @Environment(\.nTheme) private var theme
    @State private var tab: Tab = .definition
    @State private var dragOffset: CGFloat = 0

    static let width: CGFloat = 780
    static let slideDuration: Double = 0.22
    static let dismissThreshold: CGFloat = 80

    enum Tab: String, CaseIterable {
        case definition = "Definition"
        case runs = "Runs"
    }

    private var agent: Agent? {
        monitor.agents.first(where: { $0.id == agentId })
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            VStack(spacing: 0) {
                header
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
        // drawer (section containers, the markdown card), producing visible
        // inner drop-shadows that shouldn't be there.
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 20, x: -8, y: 0)
        .offset(x: dragOffset)
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
                    withAnimation(.easeOut(duration: Self.slideDuration)) {
                        dragOffset = -Self.width
                    }
                    router.close()
                } else {
                    withAnimation(.easeOut(duration: 0.18)) {
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

    private var header: some View {
        HStack(spacing: NSpacing.md) {
            Button(action: router.close) {
                Image(systemName: "chevron.left")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut("w", modifiers: .command)
            .help("Close drawer (⌘W)")

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(agent?.name ?? agentId)
                    .font(NTypography.headlineMedium)
                    .foregroundStyle(theme.tokens.foreground)
                if let description = agent?.description, !description.isEmpty {
                    Text(description)
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(2)
                }
            }

            Spacer()

            tabs
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { option in
                Button {
                    tab = option
                } label: {
                    Text(option.rawValue)
                        .font(NTypography.bodySmall)
                        .fontWeight(.medium)
                        .foregroundStyle(tab == option ? theme.tokens.foreground : theme.tokens.mutedForeground)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .background(tab == option ? theme.tokens.muted : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .definition:
            definitionView
        case .runs:
            runsView
        }
    }

    private var definitionView: some View {
        // Non-scrolling vertical stack so the markdown editor can grow to fill
        // the remaining drawer height. runNow + trigger/schedule/tools stay
        // pinned at the top; the prompt section expands to bottom with padding.
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            if let agent {
                runNowRow(for: agent)
                triggerScheduleToolsRow(for: agent)
                promptSection(for: agent)
                    .frame(maxHeight: .infinity)
            } else {
                Text("Agent not found.")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
        .padding(NSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Three-column header row: Trigger · Schedule · Tools. Dividers between
    /// columns give it the same boxed strip treatment as web's stat strips.
    /// Schedule shows the human-readable cron only — the raw expression is
    /// intentionally omitted to reduce clutter.
    @ViewBuilder
    private func triggerScheduleToolsRow(for agent: Agent) -> some View {
        HStack(alignment: .top, spacing: 0) {
            column(title: "Trigger", value: agent.kind.label)
            Divider().frame(height: 36)
            column(
                title: "Schedule",
                value: agent.schedule.map { CronEnglishFormatter.describe($0) } ?? "—"
            )
            Divider().frame(height: 36)
            column(
                title: "Tools",
                value: agent.tools.isEmpty ? "—" : agent.tools.joined(separator: ", ")
            )
        }
        .padding(NSpacing.md)
        .background(theme.tokens.card)
        .overlay(
            RoundedRectangle(cornerRadius: NRadius.sm)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    private func column(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xxxs) {
            Text(title.uppercased())
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(value)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, NSpacing.sm)
    }

    /// Prompt section: "Prompt (filename.md)" with the filename in smaller,
    /// muted type directly beside the section label. Body is the markdown
    /// editor when we can resolve the source file, else a plain text fallback.
    @ViewBuilder
    private func promptSection(for agent: Agent) -> some View {
        let fileURL = AgentFile.find(agentId: agent.id)?.url
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: NSpacing.xs) {
                Text("PROMPT")
                    .font(NTypography.labelSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                if let fileURL {
                    Text("(\(fileURL.lastPathComponent))")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground.opacity(0.7))
                }
            }
            if let fileURL {
                AgentPromptEditor(fileURL: fileURL)
                    .id(fileURL)
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    Text(agent.prompt)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: .infinity)
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var runsView: some View {
        // Full AgentRunsView (list + RunDetailView) instead of the old
        // active-runs-only stub that rendered 'No active runs.' when
        // nothing was in-flight.
        AgentRunsView(agentId: agentId, monitor: monitor)
    }


    /// Primary action row at the top of the definition view. Big gold
    /// Run button triggers the agent, disabled while it's actively running.
    @ViewBuilder
    private func runNowRow(for agent: Agent) -> some View {
        let running = monitor.activeRuns.contains { $0.agentId == agent.id }
        HStack(spacing: NSpacing.sm) {
            Button {
                monitor.triggerRun(agentId: agent.id)
            } label: {
                HStack(spacing: NSpacing.xs) {
                    if running {
                        ProgressView().controlSize(.mini).tint(theme.tokens.primaryForeground)
                    } else {
                        Image(systemName: "play.fill")
                    }
                    Text(running ? "Running…" : "Run now")
                        .font(NTypography.bodyMedium)
                        .fontWeight(.semibold)
                }
                .padding(.horizontal, NSpacing.md)
                .padding(.vertical, NSpacing.xs)
                .foregroundStyle(theme.tokens.primaryForeground)
                .background(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .fill(theme.tokens.primary)
                )
            }
            .buttonStyle(.plain)
            .disabled(running || !agent.enabled)

            if !agent.enabled {
                Text("Disabled")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .padding(.horizontal, NSpacing.xs)
                    .padding(.vertical, 2)
                    .background(theme.tokens.muted)
                    .clipShape(Capsule())
            }
            Spacer()
        }
    }

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(title.uppercased())
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            content()
        }
    }
}
