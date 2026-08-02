import Foundation

/// The versioned local payload shared by the server's Today and Activity surfaces.
struct TodayActivitySnapshot: Decodable, Equatable, Sendable {
    let today: ContractTodayPresentation
    let activity: ContractActivityPresentation

    static func decode(from data: Data) throws -> TodayActivitySnapshot {
        try JSONDecoder().decode(TodayActivitySnapshot.self, from: data)
    }

    func makeTodayPresentation() -> TodayPresentation {
        let items = today.sections.flatMap { section -> [TodayItem] in
            guard let presentationSection = section.kind.presentationSection else { return [] }
            return section.items.compactMap { item in
                guard item.section.presentationSection == presentationSection else { return nil }
                guard let date = item.occurredAt ?? item.scheduledAt else { return nil }
                return TodayItem(
                    id: item.id,
                    assistantID: item.assistant.localAgentId,
                    assistantInstallationID: item.assistant.installationId,
                    assistantMachineID: item.assistant.machineId,
                    assistantName: item.assistant.displayName,
                    section: presentationSection,
                    headlineStatement: item.headline,
                    explanationStatement: item.explanation,
                    date: date,
                    expiresAt: item.expiresAt,
                    primaryAction: item.primaryAction,
                    secondaryDisclosure: item.secondaryDisclosure,
                    sourceReferences: item.sourceReferences
                )
            }
        }
        return TodayPresentation(items: items)
    }

    func makeActivityPresentation(filter: ActivityFilter) -> ActivityPresentation {
        let items = activity.items.compactMap { item -> ActivityItem? in
            guard let state = item.state.presentationState else { return nil }
            return ActivityItem(
                id: item.id,
                assistantID: item.assistant.localAgentId,
                assistantInstallationID: item.assistant.installationId,
                assistantMachineID: item.assistant.machineId,
                assistantName: item.assistant.displayName,
                conversationID: item.conversationId,
                state: state,
                headlineStatement: item.headline,
                outcomeSummaryStatement: item.outcomeSummary,
                startedAt: item.startedAt,
                endedAt: item.endedAt,
                primaryOutputStatement: item.primaryOutput,
                reviewReference: item.reviewReference,
                sourceReferences: item.sourceReferences
            )
        }
        return ActivityPresentation(items: items, filter: filter)
    }
}
