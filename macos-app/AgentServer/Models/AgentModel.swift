import Foundation

struct Agent: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let schedule: String?
    let prompt: String
    let tools: [String]
    let maxTurns: Int
    let enabled: Bool
    let watch: [FileWatch]?
    let interaction: InteractionConfig?
    let notification: NotificationConfig?
    let onComplete: [TriggerRef]?
    let onFailure: [TriggerRef]?

    enum CodingKeys: String, CodingKey {
        case id, name, description, schedule, prompt, tools, enabled
        case watch, interaction, notification
        case maxTurns = "max_turns"
        case onComplete = "on_complete"
        case onFailure = "on_failure"
    }

    var isScheduled: Bool {
        schedule != nil
    }

    var hasWatch: Bool {
        guard let watch else { return false }
        return !watch.isEmpty
    }

    var isInteractive: Bool {
        interaction != nil
    }

    var isChained: Bool {
        let hasComplete = onComplete.map { !$0.isEmpty } ?? false
        let hasFailure = onFailure.map { !$0.isEmpty } ?? false
        return hasComplete || hasFailure
    }

    var kind: AgentKind {
        if isInteractive { return .interactive }
        if hasWatch { return .watcher }
        if isScheduled { return .scheduled }
        if isChained { return .chained }
        return .onDemand
    }

    var scheduleDisplay: String {
        guard let schedule else { return "On-demand" }
        return CronDescriber.describe(schedule)
    }
}

struct FileWatch: Codable {
    let path: String
    let glob: String?
}

struct InteractionConfig: Codable {
    let channel: String?
    let onReply: String?
    let timeout: String?

    enum CodingKeys: String, CodingKey {
        case channel, timeout
        case onReply = "on_reply"
    }
}

struct NotificationConfig: Codable {
    let channel: String?
    let onComplete: Bool?
    let onFailure: Bool?

    enum CodingKeys: String, CodingKey {
        case channel
        case onComplete = "on_complete"
        case onFailure = "on_failure"
    }
}

struct TriggerRef: Codable {
    let agent: String
}

enum AgentKind {
    case scheduled
    case interactive
    case watcher
    case chained
    case onDemand

    var icon: String {
        switch self {
        case .scheduled: return "clock"
        case .interactive: return "bubble.left.and.bubble.right"
        case .watcher: return "eye"
        case .chained: return "link"
        case .onDemand: return "play.circle"
        }
    }

    var label: String {
        switch self {
        case .scheduled: return "Scheduled"
        case .interactive: return "Interactive"
        case .watcher: return "File watcher"
        case .chained: return "Chained"
        case .onDemand: return "On-demand"
        }
    }

    var color: AgentKindColor {
        switch self {
        case .scheduled: return AgentKindColor(r: 0.35, g: 0.55, b: 0.95)    // blue
        case .interactive: return AgentKindColor(r: 0.65, g: 0.40, b: 0.85)  // purple
        case .watcher: return AgentKindColor(r: 0.25, g: 0.70, b: 0.75)      // teal
        case .chained: return AgentKindColor(r: 0.85, g: 0.55, b: 0.25)      // orange
        case .onDemand: return AgentKindColor(r: 0.30, g: 0.72, b: 0.45)     // green
        }
    }
}

struct AgentKindColor {
    let r: Double
    let g: Double
    let b: Double
}

enum CronDescriber {
    static func describe(_ expression: String) -> String {
        let parts = expression.split(separator: " ").map(String.init)
        guard parts.count == 5 else { return expression }

        let minute = parts[0]
        let hour = parts[1]
        let dayOfMonth = parts[2]
        let month = parts[3]
        let dayOfWeek = parts[4]

        if minute == "*" && hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return "Every minute"
        }

        if let interval = parseInterval(minute), hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return interval == 1 ? "Every minute" : "Every \(interval) minutes"
        }

        if let interval = parseInterval(hour), minute == "0" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return interval == 1 ? "Every hour" : "Every \(interval) hours"
        }

        if let fixedMinute = Int(minute), let fixedHour = Int(hour), dayOfMonth == "*" && month == "*" {
            let time = formatTime(hour: fixedHour, minute: fixedMinute)

            if dayOfWeek == "*" {
                return "Daily at \(time)"
            }

            if dayOfWeek == "1-5" {
                return "Weekdays at \(time)"
            }

            if let dayName = describeDayOfWeek(dayOfWeek) {
                return "\(dayName) at \(time)"
            }
        }

        if let fixedMinute = Int(minute), let fixedHour = Int(hour),
           let fixedDay = Int(dayOfMonth), month == "*" && dayOfWeek == "*" {
            let time = formatTime(hour: fixedHour, minute: fixedMinute)
            let ordinal = ordinalSuffix(fixedDay)
            return "\(ordinal) of each month at \(time)"
        }

        return expression
    }

    private static func parseInterval(_ field: String) -> Int? {
        guard field.hasPrefix("*/"), let value = Int(field.dropFirst(2)) else { return nil }
        return value
    }

    private static func formatTime(hour: Int, minute: Int) -> String {
        let period = hour >= 12 ? "PM" : "AM"
        let displayHour = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
        return minute == 0
            ? "\(displayHour) \(period)"
            : String(format: "%d:%02d %s", displayHour, minute, period)
    }

    private static func describeDayOfWeek(_ field: String) -> String? {
        let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

        if let single = Int(field), (0...6).contains(single) {
            return "Every \(dayNames[single])"
        }

        let rangeParts = field.split(separator: "-").compactMap { Int($0) }
        if rangeParts.count == 2,
           (0...6).contains(rangeParts[0]),
           (0...6).contains(rangeParts[1]) {
            return "\(dayNames[rangeParts[0]])-\(dayNames[rangeParts[1]])"
        }

        let dayParts = field.split(separator: ",").compactMap { Int($0) }
        if !dayParts.isEmpty && dayParts.allSatisfy({ (0...6).contains($0) }) {
            let names = dayParts.map { dayNames[$0] }
            return names.joined(separator: ", ")
        }

        return nil
    }

    private static func ordinalSuffix(_ day: Int) -> String {
        let suffix: String
        switch day {
        case 1, 21, 31: suffix = "st"
        case 2, 22: suffix = "nd"
        case 3, 23: suffix = "rd"
        default: suffix = "th"
        }
        return "\(day)\(suffix)"
    }
}
