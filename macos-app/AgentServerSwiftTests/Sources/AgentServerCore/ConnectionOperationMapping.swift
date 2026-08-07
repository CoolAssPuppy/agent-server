import Foundation

public struct ConnectionCapabilityOperation: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let runtimeName: String
    public let effects: [String]
    public let classification: String
    public let inputFields: [String]

    public init(
        id: String,
        runtimeName: String,
        effects: [String],
        classification: String,
        inputFields: [String]
    ) {
        self.id = id
        self.runtimeName = runtimeName
        self.effects = effects
        self.classification = classification
        self.inputFields = inputFields
    }

    enum CodingKeys: String, CodingKey {
        case id, effects, classification
        case runtimeName = "runtime_name"
        case inputFields = "input_fields"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        runtimeName = try container.decode(String.self, forKey: .runtimeName)
        effects = try container.decode([String].self, forKey: .effects)
        classification = try container.decode(String.self, forKey: .classification)
        inputFields = try container.decodeIfPresent([String].self, forKey: .inputFields) ?? []
    }
}

public struct ConnectionOperationTarget: Codable, Equatable, Sendable {
    public let argument: String
    public let resourceType: String

    public init(argument: String, resourceType: String) {
        self.argument = argument
        self.resourceType = resourceType
    }

    enum CodingKeys: String, CodingKey {
        case argument
        case resourceType = "resource_type"
    }
}

public struct ConnectionOperationMapping: Codable, Equatable, Sendable {
    public let runtimeName: String
    public let effect: String
    public let target: ConnectionOperationTarget?

    enum CodingKeys: String, CodingKey {
        case effect, target
        case runtimeName = "runtime_name"
    }
}

public struct ConnectionOperationReviewResponse: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Equatable, Sendable {
        case unchecked, unmapped, current, stale
    }

    public let status: Status
    public let capabilityVersion: String?
    public let capturedAt: String?
    public let mappingRevision: Int
    public let mappingCapabilityVersion: String?
    public let operations: [String: ConnectionOperationMapping]
    public let inventory: [ConnectionCapabilityOperation]

    public init(
        status: Status,
        capabilityVersion: String?,
        capturedAt: String?,
        mappingRevision: Int,
        mappingCapabilityVersion: String?,
        operations: [String: ConnectionOperationMapping],
        inventory: [ConnectionCapabilityOperation]
    ) {
        self.status = status
        self.capabilityVersion = capabilityVersion
        self.capturedAt = capturedAt
        self.mappingRevision = mappingRevision
        self.mappingCapabilityVersion = mappingCapabilityVersion
        self.operations = operations
        self.inventory = inventory
    }

    enum CodingKeys: String, CodingKey {
        case status, operations, inventory
        case capabilityVersion = "capability_version"
        case capturedAt = "captured_at"
        case mappingRevision = "mapping_revision"
        case mappingCapabilityVersion = "mapping_capability_version"
    }
}

public struct ConnectionOperationMappingInput: Codable, Equatable, Sendable {
    public let runtimeName: String
    public let effect: String
    public let target: ConnectionOperationTarget?

    public init(runtimeName: String, effect: String, target: ConnectionOperationTarget?) {
        self.runtimeName = runtimeName
        self.effect = effect
        self.target = target
    }

    enum CodingKeys: String, CodingKey {
        case effect, target
        case runtimeName = "runtime_name"
    }
}

public struct ConnectionOperationMappingRequest: Codable, Equatable, Sendable {
    public let expectedRevision: Int
    public let capabilityVersion: String
    public let operations: [String: ConnectionOperationMappingInput]

    enum CodingKeys: String, CodingKey {
        case operations
        case expectedRevision = "expected_revision"
        case capabilityVersion = "capability_version"
    }
}

public struct ConnectionOperationMappingSaveResponse: Codable, Equatable, Sendable {
    public let revision: Int
    public let capabilityVersion: String
    public let updatedAt: String
    public let operations: [String: ConnectionOperationMapping]

    enum CodingKeys: String, CodingKey {
        case revision, operations
        case capabilityVersion = "capability_version"
        case updatedAt = "updated_at"
    }
}

public enum ConnectionOperationMappingError: Error, Equatable {
    case unchecked
    case invalidSemanticOperation(String)
    case duplicateSemanticOperation(String)
    case incompleteTarget(String)
    case unavailableTargetArgument(String)
}

public struct ConnectionOperationMappingRow: Equatable, Identifiable, Sendable {
    public var id: String { runtimeName }
    public let runtimeName: String
    public let classification: String
    public let inputFields: [String]
    public var effect: String
    public var semanticOperation: String
    public var targetArgument: String
    public var resourceType: String
}

public struct ConnectionOperationMappingDraft: Equatable, Sendable {
    public let capabilityVersion: String
    public let revision: Int
    public var rows: [ConnectionOperationMappingRow]

    public init(response: ConnectionOperationReviewResponse) throws {
        guard let capabilityVersion = response.capabilityVersion else {
            throw ConnectionOperationMappingError.unchecked
        }
        self.capabilityVersion = capabilityVersion
        revision = response.mappingRevision
        let semanticByRuntime = Dictionary(uniqueKeysWithValues: response.operations.map { semantic, mapping in
            (mapping.runtimeName, (semantic, mapping))
        })
        rows = response.inventory.map { operation in
            let existing = semanticByRuntime[operation.runtimeName]
            return ConnectionOperationMappingRow(
                runtimeName: operation.runtimeName,
                classification: operation.classification,
                inputFields: operation.inputFields,
                effect: existing?.1.effect ?? Self.effect(for: operation),
                semanticOperation: existing?.0 ?? "",
                targetArgument: existing?.1.target?.argument ?? "",
                resourceType: existing?.1.target?.resourceType ?? ""
            )
        }
    }

    public func makeRequest() throws -> ConnectionOperationMappingRequest {
        var operations: [String: ConnectionOperationMappingInput] = [:]
        for row in rows {
            let semantic = row.semanticOperation.trimmingCharacters(in: .whitespacesAndNewlines)
            if semantic.isEmpty { continue }
            guard semantic.range(
                of: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
                options: .regularExpression
            ) != nil else {
                throw ConnectionOperationMappingError.invalidSemanticOperation(semantic)
            }
            guard operations[semantic] == nil else {
                throw ConnectionOperationMappingError.duplicateSemanticOperation(semantic)
            }
            let argument = row.targetArgument.trimmingCharacters(in: .whitespacesAndNewlines)
            let resourceType = row.resourceType.trimmingCharacters(in: .whitespacesAndNewlines)
            if argument.isEmpty != resourceType.isEmpty {
                throw ConnectionOperationMappingError.incompleteTarget(row.runtimeName)
            }
            if !argument.isEmpty && !row.inputFields.contains(argument) {
                throw ConnectionOperationMappingError.unavailableTargetArgument(argument)
            }
            operations[semantic] = ConnectionOperationMappingInput(
                runtimeName: row.runtimeName,
                effect: row.effect,
                target: argument.isEmpty ? nil : ConnectionOperationTarget(
                    argument: argument,
                    resourceType: resourceType
                )
            )
        }
        return ConnectionOperationMappingRequest(
            expectedRevision: revision,
            capabilityVersion: capabilityVersion,
            operations: operations
        )
    }

    private static func effect(for operation: ConnectionCapabilityOperation) -> String {
        operation.classification == "curated"
            && !operation.effects.isEmpty
            && operation.effects.allSatisfy { $0 == "read" }
            ? "read"
            : "write"
    }
}
