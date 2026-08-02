import Foundation

enum TodaySection: String, CaseIterable, Equatable, Sendable {
    case needsYou
    case working
    case finished
    case problems
    case upcoming

    var title: String {
        switch self {
        case .needsYou: "Needs you"
        case .working: "Working"
        case .finished: "Finished"
        case .problems: "Problems"
        case .upcoming: "Upcoming"
        }
    }
}

struct TodayItem: Equatable, Identifiable, Sendable {
    let id: String
    let assistantID: String
    let assistantName: String
    let section: TodaySection
    let headline: String
    let explanation: String
    let date: Date
    let expiresAt: Date?
    let primaryAction: String
}

struct TodayPresentationSection: Equatable, Identifiable, Sendable {
    let section: TodaySection
    let items: [TodayItem]

    var id: TodaySection { section }
    var title: String { section.title }
}

struct TodayPresentation: Equatable, Sendable {
    let sections: [TodayPresentationSection]

    let emptyStateTitle = "You're all caught up"
    let emptyStateExplanation = "Finished work and upcoming runs will appear here."

    var isEmpty: Bool { sections.isEmpty }

    init(items: [TodayItem]) {
        let resolvedItems = Self.resolveSectionPrecedence(items)
        sections = TodaySection.allCases.compactMap { section in
            let matchingItems = resolvedItems.filter { $0.section == section }
            guard !matchingItems.isEmpty else { return nil }
            return TodayPresentationSection(
                section: section,
                items: Self.sort(matchingItems, in: section)
            )
        }
    }

    private static func resolveSectionPrecedence(_ items: [TodayItem]) -> [TodayItem] {
        var resolvedItems: [TodayItem] = []
        var indexByID: [String: Int] = [:]

        for item in items {
            guard let index = indexByID[item.id] else {
                indexByID[item.id] = resolvedItems.count
                resolvedItems.append(item)
                continue
            }

            if shouldReplace(resolvedItems[index].section, with: item.section) {
                resolvedItems[index] = item
            }
        }

        return resolvedItems
    }

    private static func shouldReplace(
        _ current: TodaySection,
        with candidate: TodaySection
    ) -> Bool {
        switch (current, candidate) {
        case (.problems, .needsYou), (.upcoming, .working): true
        default: false
        }
    }

    private static func sort(_ items: [TodayItem], in section: TodaySection) -> [TodayItem] {
        items.enumerated().sorted { left, right in
            let comparison = compare(left.element, right.element, in: section)
            return comparison ?? (left.offset < right.offset)
        }.map(\.element)
    }

    private static func compare(
        _ left: TodayItem,
        _ right: TodayItem,
        in section: TodaySection
    ) -> Bool? {
        switch section {
        case .needsYou:
            switch (left.expiresAt, right.expiresAt) {
            case let (leftExpiry?, rightExpiry?) where leftExpiry != rightExpiry:
                return leftExpiry < rightExpiry
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            default:
                return left.date == right.date ? nil : left.date > right.date
            }
        case .upcoming:
            return left.date == right.date ? nil : left.date < right.date
        case .working, .finished, .problems:
            return left.date == right.date ? nil : left.date > right.date
        }
    }
}
