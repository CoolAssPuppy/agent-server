import Foundation

public struct AgentRuntimeProvider: Codable, Equatable, Sendable {
    public let baseURL: String
    public let apiKey: String?

    public init(baseURL: String, apiKey: String?) {
        self.baseURL = baseURL
        self.apiKey = apiKey
    }

    enum CodingKeys: String, CodingKey {
        case baseURL = "base_url"
        case apiKey = "api_key"
    }
}

public struct AgentRuntimeAssignmentResponse: Codable, Equatable, Sendable {
    public enum Source: String, Codable, Equatable, Sendable {
        case savedAssignment = "saved_assignment"
        case legacyFrontmatter = "legacy_frontmatter"
        case defaultRuntime = "default"
    }

    public let source: Source
    public let agentID: String?
    public let executor: String
    public let model: String?
    public let provider: AgentRuntimeProvider?
    public let revision: Int
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case source, executor, model, provider, revision
        case agentID = "agent_id"
        case updatedAt = "updated_at"
    }
}

public struct AgentRuntimeAssignmentRequest: Codable, Equatable, Sendable {
    public let executor: String
    public let model: String?
    public let provider: AgentRuntimeProvider?
    public let expectedRevision: Int

    public init(
        executor: String,
        model: String?,
        provider: AgentRuntimeProvider?,
        expectedRevision: Int
    ) {
        self.executor = executor
        self.model = model
        self.provider = provider
        self.expectedRevision = expectedRevision
    }

    enum CodingKeys: String, CodingKey {
        case executor, model, provider
        case expectedRevision = "expected_revision"
    }
}

public struct AgentRuntimeCompatibilityIssue: Codable, Equatable, Sendable, Identifiable {
    public let code: String
    public let message: String
    public let use: String?
    public let operation: String?
    public let resource: String?

    public var id: String {
        [code, use, operation, resource, message].compactMap { $0 }.joined(separator: ":")
    }
}

public struct AgentRuntimeCompatibility: Codable, Equatable, Sendable {
    public enum State: String, Codable, Equatable, Sendable {
        case compatible
        case needsConnection = "needs_connection"
        case needsReview = "needs_review"
        case blocked
    }

    public let state: State
    public let issues: [AgentRuntimeCompatibilityIssue]

    public var canSelect: Bool { state == .compatible }
}
