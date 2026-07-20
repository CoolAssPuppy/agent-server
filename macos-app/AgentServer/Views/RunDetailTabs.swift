import SwiftUI
import AgentServerDesignSystem

// MARK: - Activity tab

struct ActivityTabView: View {
    let run: Run
    let logs: [PanelLog]

    @Environment(\.nTheme) private var theme

    private var timelineEntries: [PanelLog] {
        logs.filter { !$0.isHeartbeat }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !timelineEntries.isEmpty {
                    ForEach(Array(timelineEntries.enumerated()), id: \.element.id) { index, log in
                        TimelineRow(
                            message: log.message,
                            isLast: index == timelineEntries.count - 1,
                            timestamp: log.timestamp,
                            turnsCompleted: log.turnsCompleted,
                            level: log.level
                        )
                    }
                } else if !run.progressMessages.isEmpty {
                    ForEach(Array(run.progressMessages.enumerated()), id: \.offset) { index, message in
                        TimelineRow(
                            message: message,
                            isLast: index == run.progressMessages.count - 1
                        )
                    }
                } else {
                    emptyState
                }
            }
            .padding(NSpacing.lg)
        }
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "list.bullet")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.4))
            Text("No activity yet")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, NSpacing.huge)
    }
}

// MARK: - Timeline row

struct TimelineRow: View {
    let message: String
    let isLast: Bool
    var timestamp: Date? = nil
    var turnsCompleted: Int? = nil
    var level: String? = nil

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    private var isToolUse: Bool { message.hasPrefix("Using tool:") }

    private var displayMessage: String {
        isToolUse ? String(message.dropFirst("Using tool: ".count)) : message
    }

    private var dotColor: Color {
        if isToolUse { return .purple }
        if level == "error" { return .red }
        return .secondary
    }

    private var accessibilityPresentation: TimelineRowAccessibilityPresentation {
        TimelineRowAccessibilityPresentation(
            message: isToolUse ? formatToolName(displayMessage) : displayMessage,
            kind: isToolUse ? .toolUse : (level == "error" ? .error : .update),
            turn: turnsCompleted,
            time: timestamp.map(Self.timeFormatter.string(from:))
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.md) {
            VStack(spacing: 0) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)

                if !isLast {
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 1)
                        .frame(minHeight: NSpacing.lg)
                }
            }
            .frame(width: 7)

            VStack(alignment: .leading, spacing: NSpacing.xxxs) {
                HStack(spacing: NSpacing.xs) {
                    if isToolUse {
                        Text(formatToolName(displayMessage))
                            .font(.system(.caption, design: .monospaced, weight: .medium))
                            .foregroundStyle(.purple)
                    } else {
                        Text(displayMessage)
                            .font(NTypography.caption)
                            .foregroundStyle(level == "error" ? .red : .secondary)
                            .lineLimit(3)
                    }

                    Spacer()

                    if let turns = turnsCompleted {
                        Text("T\(turns)")
                            .font(.system(.caption2, design: .monospaced, weight: .medium))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, NSpacing.xxs)
                            .padding(.vertical, 1)
                            .background(.tertiary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
                    }

                    if let timestamp {
                        Text(Self.timeFormatter.string(from: timestamp))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.quaternary)
                    }
                }
            }
            .padding(.bottom, isLast ? 0 : NSpacing.sm)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityPresentation.label)
    }
}

// MARK: - Logs tab

struct LogsTabView: View {
    let logs: [PanelLog]
    let isLive: Bool

    @Environment(\.nTheme) private var theme
    @State private var isFollowing = true

    private static let msFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    var body: some View {
        if logs.isEmpty {
            emptyState
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(logs) { log in
                            logRow(log)
                                .id(log.id)
                        }
                    }
                    .padding(NSpacing.lg)
                }
                .onChange(of: logs.count) { _, _ in
                    if isLive && isFollowing, let last = logs.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
    }

    private func logRow(_ log: PanelLog) -> some View {
        let level = LogLevel(raw: log.level)

        return HStack(alignment: .firstTextBaseline, spacing: NSpacing.sm) {
            Text(Self.msFormatter.string(from: log.timestamp))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.6))
                .frame(width: 80, alignment: .leading)

            Text(level.label)
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .foregroundStyle(level.color)
                .frame(width: 30)

            Text(log.message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(level == .error || level == .fatal ? .red : theme.tokens.foreground.opacity(0.8))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, NSpacing.xxxs)
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "scroll")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.4))
            Text(isLive ? "Waiting for logs..." : "No logs available")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, NSpacing.huge)
    }
}

// MARK: - Decisions tab

struct RunDecisionsTabView: View {
    let viewModel: RunDecisionsViewModel

    @Environment(\.nTheme) private var theme

    var body: some View {
        if viewModel.isEmpty {
            emptyState
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.lg) {
                    if !viewModel.pending.isEmpty {
                        section(title: "Pending", decisions: viewModel.pending, isPending: true)
                    }
                    if !viewModel.history.isEmpty {
                        section(title: "History", decisions: viewModel.history, isPending: false)
                    }
                }
                .padding(NSpacing.lg)
            }
            .accessibilityLabel("Decisions for this run")
        }
    }

    private func section(title: String, decisions: [Decision], isPending: Bool) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title)
                .font(NTypography.labelMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
            ForEach(decisions) { decision in
                DecisionRunRow(decision: decision, isPending: isPending)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: NSpacing.sm) {
            Image(systemName: "questionmark.bubble")
                .font(.system(size: NIconSize.lg))
                .foregroundStyle(theme.tokens.mutedForeground.opacity(0.4))
            Text("No decisions on this run")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, NSpacing.huge)
    }
}

private struct DecisionRunRow: View {
    let decision: Decision
    let isPending: Bool

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            HStack(spacing: NSpacing.xs) {
                Text(decision.type.rawValue.capitalized)
                    .font(NTypography.badge)
                    .foregroundStyle(isPending ? theme.tokens.primaryForeground : theme.tokens.mutedForeground)
                    .padding(.horizontal, NSpacing.xs)
                    .padding(.vertical, NSpacing.xxxs)
                    .background(isPending ? theme.tokens.primary : theme.tokens.muted)
                    .clipShape(Capsule())
                Text(decision.relativeCreatedAt)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Spacer()
                if !isPending, let resolvedVia = decision.resolvedVia {
                    Text("via \(resolvedVia)")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            }
            Text(decision.title)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(NSpacing.md)
        .background(theme.tokens.muted.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isPending ? "Pending" : "Resolved") \(decision.type.rawValue) decision: \(decision.title)")
    }
}
