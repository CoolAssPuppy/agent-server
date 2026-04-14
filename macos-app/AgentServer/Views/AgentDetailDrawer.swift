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
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                if let agent {
                    section(title: "Trigger") {
                        Text(agent.kind.label)
                            .font(NTypography.bodySmall)
                            .foregroundStyle(theme.tokens.foreground)
                    }
                    if let schedule = agent.schedule {
                        section(title: "Schedule") {
                            Text(CronEnglishFormatter.describe(schedule))
                                .font(NTypography.bodySmall)
                                .foregroundStyle(theme.tokens.foreground)
                            Text(schedule)
                                .font(NTypography.captionSmall)
                                .foregroundStyle(theme.tokens.mutedForeground)
                        }
                    }
                    section(title: "Prompt") {
                        if let url = AgentFile.find(agentId: agent.id)?.url {
                            // `.id(url)` forces the StateObject-backed
                            // Loader to reset when the user switches agents
                            // while the drawer is open — otherwise the
                            // editor keeps showing the previous agent's
                            // markdown.
                            AgentPromptEditor(fileURL: url).id(url)
                        } else {
                            Text(agent.prompt)
                                .font(NTypography.bodySmall)
                                .foregroundStyle(theme.tokens.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if !agent.tools.isEmpty {
                        section(title: "Tools") {
                            Text(agent.tools.joined(separator: ", "))
                                .font(NTypography.bodySmall)
                                .foregroundStyle(theme.tokens.foreground)
                        }
                    }
                } else {
                    Text("Agent not found.")
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            .padding(NSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var runsView: some View {
        let runs = monitor.activeRuns.filter { $0.agentId == agentId }
        return ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                if runs.isEmpty {
                    Text("No active runs.")
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.mutedForeground)
                } else {
                    ForEach(runs, id: \.runId) { run in
                        runRow(run)
                    }
                }
            }
            .padding(NSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func runRow(_ run: Run) -> some View {
        HStack(spacing: NSpacing.md) {
            Circle()
                .fill(run.status.displayColor)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                Text(run.runId)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.foreground)
                Text(run.status.displayLabel)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            Spacer()
        }
        .padding(NSpacing.sm)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
    }

    @ViewBuilder
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
