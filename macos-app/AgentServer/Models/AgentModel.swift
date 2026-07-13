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
        if let schedule {
            return CronEnglishFormatter.describe(schedule)
        }
        return AgentTriggerPresentation(schedule: nil, hasWatch: hasWatch).fallbackLabel ?? "On demand"
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
        case .watcher: return "File watch"
        case .chained: return "Chained"
        case .onDemand: return "On demand"
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
