import SwiftUI
import NerdsUI

/// Home pane. The app's soul is agents quietly working on a schedule, so the
/// home leads with a warm greeting and a single signature — "Up next", the very
/// next thing an agent will do — then recent activity and the day ahead. No
/// grid of empty ops cards; empty states stay calm and small.
struct MainPane: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @Environment(\.nTheme) private var theme

    private var runningRun: Run? { monitor.activeRuns.first }


    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    hero
                    next12HoursCard
                    activityColumn
                }
                .padding(.horizontal, NSpacing.xxl)
                .padding(.top, NSpacing.xxl)
                .padding(.bottom, NSpacing.xxl)
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.tokens.background)
    }

    // MARK: - Hero

    private var hero: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: NSpacing.xs) {
                Text(greetingCopy)
                    .font(NTypography.displayMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Text(subtitleCopy)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            Spacer()
            watchingBadge
        }
    }

    /// A quiet "N agents on watch" badge — conveys the app is alive without a
    /// loud number tile.
    private var watchingBadge: some View {
        let count = monitor.agents.filter(\.enabled).count
        return HStack(spacing: NSpacing.xs) {
            Circle()
                .fill(theme.tokens.success)
                .frame(width: 6, height: 6)
            Text("\(count) on watch")
                .font(NTypography.labelSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .padding(.horizontal, NSpacing.sm)
        .padding(.vertical, NSpacing.xs)
        .background(theme.tokens.card, in: Capsule())
        .overlay(Capsule().stroke(theme.tokens.border, lineWidth: 1))
    }

    private var greetingCopy: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good morning."
        case 12..<17: return "Good afternoon."
        case 17..<22: return "Good evening."
        default: return "Working late?"
        }
    }

    private var subtitleCopy: String {
        let decisions = monitor.pendingDecisions.filter(\.isPending).count
        if decisions > 0 {
            return "\(decisions) decision\(decisions == 1 ? "" : "s") need your call."
        }
        if let run = runningRun {
            return "\(run.agentName) is working right now."
        }
        if monitor.agents.contains(where: { $0.enabled }) {
            return "Your agents are watching over the day."
        }
        return "Create an agent and it will get to work."
    }

    // MARK: - Up next (signature)

    /// The home's one warm signature: everything happening in the next 12
    /// hours. A live run sits at the top; then each upcoming scheduled run with
    /// its time. This is the single "what's happening" surface — no duplicate
    /// column below.
    private var next12HoursCard: some View {
        let upcoming = upcoming12h
        let running = runningRun
        return VStack(alignment: .leading, spacing: NSpacing.md) {
            Text("NEXT 12 HOURS")
                .font(NTypography.labelSmall)
                .tracking(0.8)
                .foregroundStyle(theme.tokens.accent)

            if running == nil && upcoming.isEmpty {
                Text("Nothing scheduled in the next 12 hours.")
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            } else {
                VStack(spacing: 0) {
                    if let run = running {
                        WorkingNowRow(name: run.agentName)
                        if !upcoming.isEmpty { Divider().opacity(0.2) }
                    }
                    ForEach(Array(upcoming.prefix(8).enumerated()), id: \.element.agent.id) { index, item in
                        if index > 0 { Divider().opacity(0.2) }
                        UpcomingRunRow(
                            name: item.agent.name,
                            relative: relativeFuture(item.date),
                            time: clockTime(item.date)
                        )
                    }
                }
            }
        }
        .padding(NSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                theme.tokens.card
                LinearGradient(
                    colors: [theme.tokens.accent.opacity(0.10), .clear],
                    startPoint: .leading, endPoint: .trailing
                )
            }
        )
        .overlay(RoundedRectangle(cornerRadius: NRadius.lg).stroke(theme.tokens.accent.opacity(0.30), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.lg))
    }

    // MARK: - Activity

    private var activityColumn: some View {
        let runs = Array(monitor.recentRuns.prefix(7))
        return VStack(alignment: .leading, spacing: NSpacing.sm) {
            eyebrow("Recent activity")
            if runs.isEmpty {
                calmEmpty("When an agent finishes, you'll see it here.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(runs.enumerated()), id: \.element.runId) { index, run in
                        if index > 0 { Divider().opacity(0.25) }
                        ActivityRow(run: run)
                    }
                }
                .modifier(ElevatedSurface())
            }
        }
    }

    // MARK: - Coming up

    /// Every enabled agent whose next scheduled run falls within the next 12
    /// hours, soonest first — so the home shows all of what's coming, not just
    /// the single imminent one.
    private var upcoming12h: [(agent: Agent, date: Date)] {
        let now = Date()
        let horizon = now.addingTimeInterval(12 * 3600)
        var items: [(agent: Agent, date: Date)] = []
        for agent in monitor.agents where agent.enabled {
            guard let schedule = agent.schedule,
                  let next = CronNextFire.next(schedule, after: now) else { continue }
            if next <= horizon { items.append((agent, next)) }
        }
        return items.sorted { $0.date < $1.date }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: NSpacing.md) {
            Button {
                router.openConnections()
            } label: {
                Label("Connections", systemImage: "link")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Services your agents can use")

            Button {
                router.openSecurity()
            } label: {
                Label("Security check", systemImage: "checkmark.shield")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Review agent access and safety")
            .accessibilityIdentifier(ConsumerFlowAccessibility.securityNavigation)

            Spacer()

            Button {
                router.openSettings()
            } label: {
                Label("Settings", systemImage: "gearshape")
                    .labelStyle(.iconOnly)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Settings")
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.sm)
        .overlay(alignment: .top) { Divider().opacity(0.4) }
    }

    // MARK: - Small helpers

    private func eyebrow(_ text: String) -> some View {
        Text(text.uppercased())
            .font(NTypography.labelSmall)
            .tracking(0.8)
            .foregroundStyle(theme.tokens.mutedForeground)
    }

    private func calmEmpty(_ text: String) -> some View {
        Text(text)
            .font(NTypography.bodySmall)
            .foregroundStyle(theme.tokens.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(NSpacing.lg)
            .modifier(ElevatedSurface())
    }

    private func relativeFuture(_ date: Date) -> String {
        let seconds = date.timeIntervalSinceNow
        if seconds < 60 { return "in under a minute" }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .full
        return fmt.localizedString(for: date, relativeTo: Date())
    }

    private func clockTime(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}

// MARK: - Next-12-hours rows

/// A live run at the top of the Next 12 hours card, with a soft pulse so it
/// reads as happening right now.
private struct WorkingNowRow: View {
    let name: String
    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false

    var body: some View {
        HStack(spacing: NSpacing.md) {
            ZStack {
                Circle().fill(theme.tokens.warning.opacity(0.5))
                    .scaleEffect(animating ? 1.8 : 1.0)
                    .opacity(animating ? 0 : 0.7)
                Circle().fill(theme.tokens.warning).frame(width: 8, height: 8)
            }
            .frame(width: 14, height: 14)
            Text(name)
                .font(NTypography.bodyMedium)
                .fontWeight(.medium)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
            Spacer()
            Text("Working now")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.warning)
        }
        .padding(.vertical, NSpacing.sm)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { animating = true }
        }
    }
}

/// One upcoming scheduled run: name, plain-language "in N hours", and the clock
/// time.
private struct UpcomingRunRow: View {
    let name: String
    let relative: String
    let time: String
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: "clock")
                .font(.system(size: 12))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(name)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
            Spacer()
            Text(relative)
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
            Text(time)
                .font(NTypography.captionSmall)
                .fontWeight(.medium)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
        }
        .padding(.vertical, NSpacing.sm)
    }
}

// MARK: - Activity row

private struct ActivityRow: View {
    let run: Run
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Circle()
                .fill(run.status.color(theme.tokens))
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.agentName)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                if let summary = run.summary, !summary.isEmpty {
                    Text(summary)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(run.startedAt.formatted(.relative(presentation: .numeric)))
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
        }
        .padding(.horizontal, NSpacing.lg)
        .padding(.vertical, NSpacing.md)
    }
}

// MARK: - Elevated surface

/// A clean card surface: the theme's card fill and a hairline border, no
/// hardcoded highlights. Depth reads from spacing and the border, so it holds
/// up in every theme (color is the theme's job, not the layout's).
private struct ElevatedSurface: ViewModifier {
    @Environment(\.nTheme) private var theme

    func body(content: Content) -> some View {
        content
            .background(theme.tokens.card)
            .overlay(RoundedRectangle(cornerRadius: NRadius.lg).stroke(theme.tokens.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.lg))
    }
}
