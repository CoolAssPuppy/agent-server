import Foundation

enum MainPaneElevatedRegion: Equatable, Sendable {
    case upNext
}

enum MainPaneActivitySurface: Equatable, Sendable {
    case groupedRows
}

enum MainPaneVisualPolicy {
    static let elevatedRegion = MainPaneElevatedRegion.upNext
    static let activitySurface = MainPaneActivitySurface.groupedRows
}

enum MainPaneRecentActivityPolicy {
    static let itemLimit = 7

    static func groupedItems<Item>(
        from items: [Item],
        itemID: KeyPath<Item, String>,
        conversationID: KeyPath<Item, String?>,
        conversationChannel: KeyPath<Item, String?>,
        startedAt: KeyPath<Item, Date>
    ) -> [MainPaneRecentActivityItem<Item>] {
        var aggregates: [String: (channel: String?, startedAt: Date, count: Int)] = [:]
        for item in items {
            guard let id = normalizedConversationID(item[keyPath: conversationID]) else { continue }
            let date = item[keyPath: startedAt]
            if let current = aggregates[id] {
                aggregates[id] = (
                    current.channel ?? item[keyPath: conversationChannel],
                    min(current.startedAt, date),
                    current.count + 1
                )
            } else {
                aggregates[id] = (item[keyPath: conversationChannel], date, 1)
            }
        }

        var seenConversations = Set<String>()
        var output: [MainPaneRecentActivityItem<Item>] = []
        for item in items where output.count < itemLimit {
            guard let conversationID = normalizedConversationID(item[keyPath: conversationID]) else {
                output.append(.init(
                    id: "run:\(item[keyPath: itemID])",
                    run: item,
                    kind: .run
                ))
                continue
            }
            guard seenConversations.insert(conversationID).inserted,
                  let aggregate = aggregates[conversationID] else { continue }
            output.append(.init(
                id: "conversation:\(conversationID)",
                run: item,
                kind: .conversation(
                    channel: aggregate.channel,
                    startedAt: aggregate.startedAt,
                    runCount: aggregate.count
                )
            ))
        }
        return output
    }

    private static func normalizedConversationID(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

enum MainPaneRecentActivityKind: Equatable {
    case run
    case conversation(channel: String?, startedAt: Date, runCount: Int)
}

struct MainPaneRecentActivityItem<Item> {
    let id: String
    let run: Item
    let kind: MainPaneRecentActivityKind
}

enum ConversationActivityPresentation {
    static func title(channel: String?, formattedDate: String) -> String {
        let prefix = switch channel?.lowercased() {
        case "slack": "Slack conversation"
        case "telegram": "Telegram conversation"
        default: "Conversation"
        }
        return "\(prefix) from \(formattedDate)"
    }
}

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

enum RunNoticeKind: Equatable, Sendable {
    case information
    case error
}

enum RunNoticeSummaryTextStyle: Equatable, Sendable {
    case body
}

enum RunDetailMetadataPlacement: Equatable, Sendable {
    case header
    case informationTab
}

enum RunDetailPresentation {
    static let headerMetadataPlacement = RunDetailMetadataPlacement.informationTab
    static var showsHeaderMetadata: Bool { headerMetadataPlacement == .header }
    static let showsAgentName = false
    static let showsStatus = false
    static let showsCopyAll = false
}

struct RunNoticePresentation: Equatable, Sendable {
    let kind: RunNoticeKind
    let title: String
    let message: String
    let summaryTextStyle = RunNoticeSummaryTextStyle.body
    let disclosesTechnicalDetails = true

    init(status: String, code: String?, technicalMessage: String) {
        if code == "output_contract_unmet" {
            kind = .error
            title = "Required output was not confirmed"
            message = "The agent stopped without confirming the output it promised. Review what happened before trying again."
        } else if status == "skipped", code == "lock_contention" {
            kind = .information
            title = "Run not started"
            message = "This agent was already running, so this extra attempt was skipped."
        } else {
            kind = .error
            title = "Run failed"
            message = technicalMessage
        }
    }
}
