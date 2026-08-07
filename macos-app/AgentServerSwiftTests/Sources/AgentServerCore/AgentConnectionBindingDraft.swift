import Foundation

public struct AgentConnectionBindingDraft: Equatable, Sendable {
    public let uses: [String: AgentConnectionUseServerModel]
    public let skillRequirements: [String: AgentSkillRequirementServerModel]
    public let revision: Int
    private var connectionIDs: [String: String]
    private var resourceIDs: [String: [String: String]]
    private var resourceOperationIDs: [String: [String: [String: String]]]
    private var skillPaths: [String: String]

    public init(
        uses: [String: AgentConnectionUseServerModel],
        skillRequirements: [String: AgentSkillRequirementServerModel] = [:],
        bindingSet: AgentBindingSetResponse
    ) {
        self.uses = uses
        self.skillRequirements = skillRequirements
        revision = bindingSet.revision
        connectionIDs = bindingSet.connections.mapValues(\.connectionID)
        resourceIDs = bindingSet.connections.mapValues { binding in
            binding.resources.mapValues(\.id)
        }
        resourceOperationIDs = bindingSet.connections.mapValues { binding in
            binding.resources.mapValues(\.operationIDs)
        }
        skillPaths = bindingSet.skills.mapValues(\.path)
    }

    public func connectionID(for use: String) -> String {
        connectionIDs[use] ?? ""
    }

    public func resourceID(for resource: String, use: String) -> String {
        resourceIDs[use]?[resource] ?? ""
    }

    public mutating func setConnectionID(_ id: String, for use: String) {
        connectionIDs[use] = id
    }

    public mutating func setResourceID(_ id: String, resource: String, use: String) {
        var values = resourceIDs[use] ?? [:]
        values[resource] = id
        resourceIDs[use] = values
    }

    public func skillPath(for requirement: String) -> String {
        skillPaths[requirement] ?? ""
    }

    public mutating func setSkillPath(_ path: String, for requirement: String) {
        skillPaths[requirement] = path
    }

    public var isComplete: Bool {
        uses.allSatisfy { useKey, use in
            !connectionID(for: useKey).isBlank
                && use.resources.keys.allSatisfy {
                    !resourceID(for: $0, use: useKey).isBlank
                }
        } && skillRequirements.keys.allSatisfy { !skillPath(for: $0).isBlank }
    }

    public var request: AgentBindingSetRequest {
        let connections = uses.reduce(into: [String: AgentConnectionBindingRequest]()) {
            result, entry in
            let (useKey, use) = entry
            let resources = use.resources.keys.reduce(into: [String: AgentResourceBinding]()) {
                values, resourceKey in
                values[resourceKey] = AgentResourceBinding(
                    id: resourceID(for: resourceKey, use: useKey),
                    operationIDs: resourceOperationIDs[useKey]?[resourceKey] ?? [:]
                )
            }
            result[useKey] = AgentConnectionBindingRequest(
                connectionID: connectionID(for: useKey),
                resources: resources
            )
        }
        let skills = skillRequirements.keys.reduce(into: [String: AgentSkillBinding]()) {
            $0[$1] = AgentSkillBinding(path: skillPath(for: $1))
        }
        return AgentBindingSetRequest(
            expectedRevision: revision,
            connections: connections,
            skills: skills
        )
    }
}

private extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
