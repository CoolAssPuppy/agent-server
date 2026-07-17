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

    /// The soonest upcoming scheduled run across all enabled agents.
    private var upNext: (agent: Agent, date: Date)? {
        let now = Date()
        var best: (agent: Agent, date: Date)?
        for agent in monitor.agents where agent.enabled {
            guard let schedule = agent.schedule,
                  let next = CronNextFire.next(schedule, after: now) else { continue }
            if best == nil || next < best!.date {
                best = (agent, next)
            }
        }
        return best
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    hero
                    upNextSignature
                    HStack(alignment: .top, spacing: NSpacing.lg) {
                        activityColumn.frame(maxWidth: .infinity, alignment: .topLeading)
                        comingUpColumn.frame(width: 320, alignment: .topLeading)
                    }
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

    @ViewBuilder
    private var upNextSignature: some View {
        if let run = runningRun {
            SignatureRow(
                eyebrow: "Working now",
                title: run.agentName,
                detail: run.summary ?? "In progress…",
                glyph: "sparkles",
                tint: theme.tokens.warning,
                pulse: true
            )
        } else if let next = upNext {
            SignatureRow(
                eyebrow: "Up next",
                title: next.agent.name,
                detail: "\(relativeFuture(next.date)) · \(clockTime(next.date))",
                glyph: "clock",
                tint: theme.tokens.accent,
                pulse: false
            )
        } else {
            SignatureRow(
                eyebrow: "Up next",
                title: "Nothing scheduled",
                detail: "Give an agent a schedule and it will show up here.",
                glyph: "moon.stars",
                tint: theme.tokens.mutedForeground,
                pulse: false
            )
        }
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

    private var comingUpColumn: some View {
        let now = Date()
        let today = monitor.agents.filter { agent in
            guard agent.enabled, let s = agent.schedule else { return false }
            return CronNextFire.firesToday(s, now: now)
        }
        return VStack(alignment: .leading, spacing: NSpacing.sm) {
            eyebrow("The day ahead")
            if today.isEmpty {
                calmEmpty("No more runs scheduled today.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(today.prefix(6).enumerated()), id: \.element.id) { index, agent in
                        if index > 0 { Divider().opacity(0.25) }
                        ComingUpRow(agent: agent)
                    }
                }
                .modifier(ElevatedSurface())
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
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

// MARK: - Signature row

/// The one loud element on the home: a wide, warmly-tinted row that says what
/// the app is about to do (or is doing). Everything else stays quiet around it.
private struct SignatureRow: View {
    let eyebrow: String
    let title: String
    let detail: String
    let glyph: String
    let tint: Color
    let pulse: Bool

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false

    var body: some View {
        HStack(spacing: NSpacing.lg) {
            ZStack {
                Circle().fill(tint.opacity(0.16))
                Image(systemName: glyph)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(tint)
            }
            .frame(width: 46, height: 46)
            .overlay {
                if pulse {
                    Circle()
                        .stroke(tint.opacity(0.5), lineWidth: 2)
                        .scaleEffect(animating ? 1.35 : 1.0)
                        .opacity(animating ? 0 : 0.6)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(eyebrow.uppercased())
                    .font(NTypography.labelSmall)
                    .tracking(0.8)
                    .foregroundStyle(tint)
                Text(title)
                    .font(NTypography.titleMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.tokens.foreground)
                    .lineLimit(1)
                Text(detail)
                    .font(NTypography.bodySmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(NSpacing.lg)
        .background(
            ZStack {
                theme.tokens.card
                LinearGradient(
                    colors: [tint.opacity(0.10), .clear],
                    startPoint: .leading, endPoint: .trailing
                )
            }
        )
        .overlay(RoundedRectangle(cornerRadius: NRadius.lg).stroke(tint.opacity(0.30), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.lg))
        .onAppear {
            guard pulse, !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                animating = true
            }
        }
    }
}

// MARK: - Activity row

private struct ActivityRow: View {
    let run: Run
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Circle()
                .fill(run.status.displayColor)
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

// MARK: - Coming up row

private struct ComingUpRow: View {
    let agent: Agent
    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            Image(systemName: "clock")
                .font(.system(size: 12))
                .foregroundStyle(theme.tokens.mutedForeground)
            Text(agent.name)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.foreground)
                .lineLimit(1)
            Spacer()
            Text(agent.scheduleDisplay)
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
