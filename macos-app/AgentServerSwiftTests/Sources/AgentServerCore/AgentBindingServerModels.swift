import Foundation

public struct AgentConnectionResourceServerModel: Codable, Equatable, Sendable {
    public let type: String
    public let purpose: String
    public let access: AgentConnectionResourceAccess
}

public struct AgentConnectionUseServerModel: Codable, Equatable, Sendable {
    public let type: String
    public let name: String
    public let purpose: String
    public let operations: [String]
    public let resources: [String: AgentConnectionResourceServerModel]
}

public struct AgentSkillRequirementServerModel: Codable, Equatable, Sendable {
    public let name: String
    public let purpose: String
}

public struct AgentSkillBinding: Codable, Equatable, Sendable {
    public let path: String

    public init(path: String) {
        self.path = path
    }
}

public struct AgentResourceBinding: Codable, Equatable, Sendable {
    public let id: String
    public let operationIDs: [String: String]

    public init(id: String, operationIDs: [String: String] = [:]) {
        self.id = id
        self.operationIDs = operationIDs
    }

    enum CodingKeys: String, CodingKey {
        case id
        case operationIDs = "operation_ids"
    }
}

public struct AgentConnectionBindingRequest: Codable, Equatable, Sendable {
    public let connectionID: String
    public let resources: [String: AgentResourceBinding]

    public init(connectionID: String, resources: [String: AgentResourceBinding]) {
        self.connectionID = connectionID
        self.resources = resources
    }

    enum CodingKeys: String, CodingKey {
        case resources
        case connectionID = "connection_id"
    }
}

public typealias AgentConnectionBindingResponse = AgentConnectionBindingRequest

public struct AgentBindingSetResponse: Codable, Equatable, Sendable {
    public let revision: Int
    public let connections: [String: AgentConnectionBindingResponse]
    public let skills: [String: AgentSkillBinding]

    public init(
        revision: Int,
        connections: [String: AgentConnectionBindingResponse],
        skills: [String: AgentSkillBinding] = [:]
    ) {
        self.revision = revision
        self.connections = connections
        self.skills = skills
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        revision = try container.decode(Int.self, forKey: .revision)
        connections = try container.decode(
            [String: AgentConnectionBindingResponse].self,
            forKey: .connections
        )
        skills = try container.decodeIfPresent(
            [String: AgentSkillBinding].self,
            forKey: .skills
        ) ?? [:]
    }

    enum CodingKeys: String, CodingKey {
        case revision, connections, skills
    }
}

public struct AgentBindingSetRequest: Codable, Equatable, Sendable {
    public let expectedRevision: Int
    public let connections: [String: AgentConnectionBindingRequest]
    public let skills: [String: AgentSkillBinding]

    public init(
        expectedRevision: Int,
        connections: [String: AgentConnectionBindingRequest],
        skills: [String: AgentSkillBinding] = [:]
    ) {
        self.expectedRevision = expectedRevision
        self.connections = connections
        self.skills = skills
    }

    enum CodingKeys: String, CodingKey {
        case connections, skills
        case expectedRevision = "expected_revision"
    }
}
