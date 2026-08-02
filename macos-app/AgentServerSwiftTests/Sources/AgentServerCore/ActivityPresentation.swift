import Foundation

enum ActivityState: String, Equatable, Sendable {
    case needsYou
    case working
    case finished
    case problem
}

struct ActivityItem: Equatable, Identifiable, Sendable {
    let id: String
    let assistantID: String
    let assistantInstallationID: String
    let assistantMachineID: String
    let assistantName: String
    let conversationID: String?
    let state: ActivityState
    let headlineStatement: PresentationStatement
    let outcomeSummaryStatement: PresentationStatement?
    let startedAt: Date
    let endedAt: Date?
    let primaryOutputStatement: PresentationStatement?
    let reviewReference: String
    let sourceReferences: [String]

    var headline: String { headlineStatement.text }
    var outcomeSummary: String? { outcomeSummaryStatement?.text }
    var primaryOutput: String? { primaryOutputStatement?.text }
    var runID: String { String(id.dropFirst("run:".count)) }
}

extension String {
    func removingPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count))
    }
}

enum ActivityFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case needsYou
    case working
    case finished
    case problems

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .needsYou: "Needs you"
        case .working: "Working"
        case .finished: "Finished"
        case .problems: "Problems"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .all: "Show all activity"
        case .needsYou: "Show activity that needs you"
        case .working: "Show working activity"
        case .finished: "Show finished activity"
        case .problems: "Show problems"
        }
    }

    func includes(_ state: ActivityState) -> Bool {
        switch self {
        case .all: true
        case .needsYou: state == .needsYou
        case .working: state == .working
        case .finished: state == .finished
        case .problems: state == .problem
        }
    }
}

struct ActivityToolbarPresentation: Equatable, Sendable {
    let isSearchExpanded: Bool

    let subtitle = "History of work performed by agents on this Mac."

    var filterLabels: [String] {
        ActivityFilter.allCases.map { filter in
            isSearchExpanded ? String(filter.title.prefix(1)) : filter.title
        }
    }

    var filterAccessibilityLabels: [String] {
        ActivityFilter.allCases.map(\.accessibilityLabel)
    }

    func label(for filter: ActivityFilter) -> String {
        isSearchExpanded ? String(filter.title.prefix(1)) : filter.title
    }
}

struct ActivityPresentation: Equatable, Sendable {
    let filter: ActivityFilter
    let searchText: String
    let items: [ActivityItem]

    var isEmpty: Bool { items.isEmpty }

    var emptyStateExplanation: String {
        if !searchText.isEmpty {
            return "No activity matches your search."
        }
        return switch filter {
        case .all: "Agent activity will appear here."
        case .needsYou: "Nothing needs you right now."
        case .working: "No agents are working right now."
        case .finished: "No finished work matches this filter."
        case .problems: "No problems match this filter."
        }
    }

    init(items: [ActivityItem], filter: ActivityFilter, searchText: String = "") {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        self.filter = filter
        self.searchText = query
        self.items = items.enumerated()
            .filter {
                filter.includes($0.element.state)
                    && (query.isEmpty || $0.element.matches(searchText: query))
            }
            .sorted { left, right in
                if left.element.startedAt == right.element.startedAt {
                    return left.offset < right.offset
                }
                return left.element.startedAt > right.element.startedAt
            }
            .map(\.element)
    }

    func groups(
        referenceDate: Date = Date(),
        calendar: Calendar = .current
    ) -> [ActivityDateGroup] {
        let today = calendar.startOfDay(for: referenceDate)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)
        let grouped = Dictionary(grouping: items) { calendar.startOfDay(for: $0.startedAt) }

        return grouped.keys.sorted(by: >).map { date in
            let title: String
            if date == today {
                title = "Today"
            } else if date == yesterday {
                title = "Yesterday"
            } else {
                title = date.formatted(.dateTime.month(.wide).day().year())
            }
            return ActivityDateGroup(date: date, title: title, items: grouped[date] ?? [])
        }
    }
}

struct ActivityDateGroup: Equatable, Identifiable, Sendable {
    let date: Date
    let title: String
    let items: [ActivityItem]

    var id: Date { date }
}

private extension ActivityItem {
    func matches(searchText: String) -> Bool {
        [assistantName, headline, outcomeSummary, primaryOutput]
            .compactMap { $0 }
            .contains { $0.localizedCaseInsensitiveContains(searchText) }
    }
}
