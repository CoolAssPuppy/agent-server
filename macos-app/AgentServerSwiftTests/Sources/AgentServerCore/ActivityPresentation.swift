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

struct ActivityPresentation: Equatable, Sendable {
    let filter: ActivityFilter
    let items: [ActivityItem]

    var isEmpty: Bool { items.isEmpty }

    var emptyStateExplanation: String {
        switch filter {
        case .all: "Assistant activity will appear here."
        case .needsYou: "Nothing needs you right now."
        case .working: "No assistants are working right now."
        case .finished: "No finished work matches this filter."
        case .problems: "No problems match this filter."
        }
    }

    init(items: [ActivityItem], filter: ActivityFilter) {
        self.filter = filter
        self.items = items.enumerated()
            .filter { filter.includes($0.element.state) }
            .sorted { left, right in
                if left.element.startedAt == right.element.startedAt {
                    return left.offset < right.offset
                }
                return left.element.startedAt > right.element.startedAt
            }
            .map(\.element)
    }
}
