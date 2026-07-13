import Foundation

enum AgentTriggerPresentationKind: Equatable {
    case scheduled
    case watcher
    case onDemand
}

struct AgentTriggerPresentation: Equatable {
    let kind: AgentTriggerPresentationKind
    let fallbackLabel: String?

    init(schedule: String?, hasWatch: Bool) {
        if schedule != nil {
            self.kind = .scheduled
            self.fallbackLabel = nil
        } else if hasWatch {
            self.kind = .watcher
            self.fallbackLabel = "File watch"
        } else {
            self.kind = .onDemand
            self.fallbackLabel = "On demand"
        }
    }
}

enum AgentCatalogPresentation {
    static func availableAgentIds(
        agentIds: [String],
        runningAgentIds: Set<String>
    ) -> Set<String> {
        Set(agentIds).subtracting(runningAgentIds)
    }
}
