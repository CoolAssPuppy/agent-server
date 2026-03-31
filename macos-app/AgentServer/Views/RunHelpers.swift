import SwiftUI
import NerdsUI

// MARK: - Status indicator

struct StatusIndicator: View {
    let status: RunStatus

    private var icon: String {
        switch status {
        case .running: "circle.fill"
        case .completed: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        case .skipped: "minus.circle.fill"
        }
    }

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 14))
            .foregroundStyle(status.displayColor)
    }
}

// MARK: - Status badge

struct StatusBadge: View {
    let status: RunStatus

    var body: some View {
        Text(status.displayLabel)
            .font(.system(.caption, weight: .medium))
            .foregroundStyle(status.displayColor)
            .padding(.horizontal, NSpacing.sm)
            .padding(.vertical, NSpacing.xxxs)
            .background(status.displayColor.opacity(0.12))
            .clipShape(Capsule())
    }
}

// MARK: - Section header

struct RunSectionHeader: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: NSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: NIconSize.xs))
                .foregroundStyle(.secondary)
            Text(title)
                .font(NTypography.labelMedium)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Tool tag

struct ToolTag: View {
    let name: String

    private var displayName: String { formatToolName(name) }

    private var tagColor: Color {
        if name.hasPrefix("mcp__") { return .purple }
        if name == "Bash" { return .orange }
        if name == "Read" || name == "Grep" || name == "Glob" { return .blue }
        if name == "Write" || name == "Edit" { return .green }
        return .secondary
    }

    var body: some View {
        Text(displayName)
            .font(.system(.caption2, design: .monospaced, weight: .medium))
            .foregroundStyle(tagColor)
            .padding(.horizontal, NSpacing.sm)
            .padding(.vertical, NSpacing.xxs)
            .background(tagColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.xs))
    }
}

// MARK: - Copy button

struct CopyTextButton: View {
    let text: String
    let label: String
    @State private var copied = false

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
        } label: {
            Label(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(NTypography.captionSmall)
                .foregroundStyle(copied ? .green : .secondary)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Flow layout

struct FlowLayout: Layout {
    var spacing: CGFloat = NSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangeSubviews(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalHeight = y + rowHeight
        }

        return (CGSize(width: maxWidth, height: totalHeight), positions)
    }
}

// MARK: - Pulsing dot

struct PulsingDot: View {
    let color: Color
    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .shadow(color: color.opacity(isPulsing ? 0.7 : 0.2), radius: isPulsing ? 5 : 1)
            .opacity(isPulsing ? 1.0 : 0.6)
            .animation(
                .easeInOut(duration: 1.2).repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear { isPulsing = true }
    }
}

// MARK: - Formatting helpers

func formatToolName(_ name: String) -> String {
    if name.hasPrefix("mcp__") {
        let parts = name.dropFirst(5).split(separator: "__", maxSplits: 1)
        if parts.count == 2 {
            let server = parts[0].split(separator: "_").dropFirst().joined(separator: " ")
            let tool = parts[1].replacingOccurrences(of: "_", with: " ")
            return "\(server): \(tool)"
        }
    }
    return name
}

func formatDuration(_ interval: TimeInterval) -> String {
    let totalSeconds = Int(interval)
    if totalSeconds < 60 { return "\(totalSeconds)s" }
    let minutes = totalSeconds / 60
    let seconds = totalSeconds % 60
    if minutes < 60 { return "\(minutes)m \(seconds)s" }
    let hours = minutes / 60
    return "\(hours)h \(minutes % 60)m"
}

func formatTokenCount(_ count: Int) -> String {
    if count >= 1_000_000 { return String(format: "%.1fM", Double(count) / 1_000_000) }
    if count >= 1_000 { return String(format: "%.1fk", Double(count) / 1_000) }
    return "\(count)"
}

func formatCost(_ cost: Double) -> String {
    cost < 0.01 ? String(format: "$%.4f", cost) : String(format: "$%.2f", cost)
}

func abbreviatePath(_ path: String) -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    if path.hasPrefix(home) { return "~" + path.dropFirst(home.count) }
    return path
}

// MARK: - Log level styling

enum LogLevel {
    case debug, info, reasoning, warn, error, fatal

    init(raw: String) {
        switch raw.lowercased() {
        case "debug": self = .debug
        case "info": self = .info
        case "reasoning": self = .reasoning
        case "warn", "warning": self = .warn
        case "error": self = .error
        case "fatal": self = .fatal
        default: self = .info
        }
    }

    var label: String {
        switch self {
        case .debug: "DBG"
        case .info: "INF"
        case .reasoning: "RSN"
        case .warn: "WRN"
        case .error: "ERR"
        case .fatal: "FTL"
        }
    }

    var color: Color {
        switch self {
        case .debug: .gray
        case .info: .blue
        case .reasoning: .purple
        case .warn: .orange
        case .error, .fatal: .red
        }
    }
}
