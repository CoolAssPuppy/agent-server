import Foundation

struct RunRowAccessibilityPresentation: Equatable, Sendable {
    let label: String

    init(
        status: String,
        date: String,
        time: String,
        turnCount: Int,
        duration: String?,
        estimatedCost: String?,
        hasConversation: Bool
    ) {
        var parts = ["\(status) run", "\(date) at \(time)"]
        if hasConversation { parts.append("conversation") }
        if turnCount > 0 { parts.append("\(turnCount) turns") }
        if let duration { parts.append("duration \(duration)") }
        if let estimatedCost { parts.append("estimated cost \(estimatedCost)") }
        label = parts.joined(separator: ", ")
    }
}

enum TimelineRowAccessibilityKind: Equatable, Sendable {
    case update
    case toolUse
    case error
}

struct TimelineRowAccessibilityPresentation: Equatable, Sendable {
    let label: String

    init(
        message: String,
        kind: TimelineRowAccessibilityKind,
        turn: Int?,
        time: String?
    ) {
        var parts: [String]
        switch kind {
        case .update:
            parts = [message]
        case .toolUse:
            parts = ["Used tool \(message)"]
        case .error:
            parts = ["Error", message]
        }
        if let turn { parts.append("turn \(turn)") }
        if let time { parts.append(time) }
        label = parts.joined(separator: ", ")
    }
}
