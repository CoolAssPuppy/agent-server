import Foundation

public enum AgentConnectionResourceAccess: String, Codable, Equatable, Sendable {
    case read
    case write
    case readWrite = "read_write"
}

public struct AgentConnectionResourceSlot: Equatable, Sendable {
    public var key: String
    public var type: String
    public var purpose: String
    public var access: AgentConnectionResourceAccess

    public init(
        key: String,
        type: String,
        purpose: String,
        access: AgentConnectionResourceAccess
    ) {
        self.key = key
        self.type = type
        self.purpose = purpose
        self.access = access
    }
}

public enum AgentConnectionUseValidationIssue: Equatable, Sendable {
    case keyRequired
    case invalidKey(String)
    case serviceTypeRequired
    case invalidServiceType(String)
    case nameRequired
    case purposeRequired
    case operationRequired
    case invalidOperation(String)
    case duplicateOperation(String)
    case resourceKeyRequired
    case invalidResourceKey(String)
    case resourceTypeRequired(String)
    case invalidResourceType(String)
    case resourcePurposeRequired(String)
    case duplicateResourceKey(String)
}

public struct AgentConnectionUse: Equatable, Sendable {
    public var key: String
    public var serviceType: String
    public var name: String
    public var purpose: String
    public var operations: [String]
    public var resources: [AgentConnectionResourceSlot]

    public init(
        key: String,
        serviceType: String,
        name: String,
        purpose: String,
        operations: [String],
        resources: [AgentConnectionResourceSlot]
    ) {
        self.key = key
        self.serviceType = serviceType
        self.name = name
        self.purpose = purpose
        self.operations = operations
        self.resources = resources
    }

    public var isValid: Bool { validationIssues.isEmpty }

    public var validationIssues: [AgentConnectionUseValidationIssue] {
        var issues: [AgentConnectionUseValidationIssue] = []
        validateIdentity(into: &issues)
        validateOperations(into: &issues)
        validateResources(into: &issues)
        return issues
    }

    private func validateIdentity(into issues: inout [AgentConnectionUseValidationIssue]) {
        if key.isBlank {
            issues.append(.keyRequired)
        } else if !key.isLogicalKey {
            issues.append(.invalidKey(key))
        }

        if serviceType.isBlank {
            issues.append(.serviceTypeRequired)
        } else if !serviceType.isSemanticType {
            issues.append(.invalidServiceType(serviceType))
        }

        if name.isBlank { issues.append(.nameRequired) }
        if purpose.isBlank { issues.append(.purposeRequired) }
    }

    private func validateOperations(into issues: inout [AgentConnectionUseValidationIssue]) {
        if operations.isEmpty { issues.append(.operationRequired) }
        var seen: Set<String> = []
        for operation in operations {
            if !operation.isQualifiedOperation {
                issues.append(.invalidOperation(operation))
            }
            if !seen.insert(operation).inserted {
                issues.append(.duplicateOperation(operation))
            }
        }
    }

    private func validateResources(into issues: inout [AgentConnectionUseValidationIssue]) {
        var seen: Set<String> = []
        for resource in resources {
            if resource.key.isBlank {
                issues.append(.resourceKeyRequired)
            } else if !resource.key.isLogicalKey {
                issues.append(.invalidResourceKey(resource.key))
            }

            if resource.type.isBlank {
                issues.append(.resourceTypeRequired(resource.key))
            } else if !resource.type.isSemanticType {
                issues.append(.invalidResourceType(resource.type))
            }

            if resource.purpose.isBlank {
                issues.append(.resourcePurposeRequired(resource.key))
            }
            if !seen.insert(resource.key).inserted {
                issues.append(.duplicateResourceKey(resource.key))
            }
        }
    }
}

public enum AgentConnectionUseCollectionIssue: Equatable, Sendable {
    case duplicateUseKey(String)
    case duplicateUseName(String)
}

public enum AgentConnectionUseCollection {
    public static func validationIssues(
        for uses: [AgentConnectionUse]
    ) -> [AgentConnectionUseCollectionIssue] {
        var issues: [AgentConnectionUseCollectionIssue] = []
        var keys: Set<String> = []
        var names: Set<String> = []

        for connectionUse in uses {
            if !keys.insert(connectionUse.key).inserted {
                issues.append(.duplicateUseKey(connectionUse.key))
            }
            let comparableName = connectionUse.name
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            if !names.insert(comparableName).inserted {
                issues.append(.duplicateUseName(connectionUse.name))
            }
        }
        return issues
    }
}

private extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var isLogicalKey: Bool {
        guard (1...64).contains(count),
              let first = unicodeScalars.first,
              Self.lowercaseLetters.contains(first) else { return false }
        var allowed = Self.lowercaseLetters
        allowed.formUnion(.decimalDigits)
        allowed.insert("_")
        return unicodeScalars.allSatisfy(allowed.contains)
    }

    var isSemanticType: Bool {
        hasValidSemanticSegments
    }

    var isQualifiedOperation: Bool {
        hasValidSemanticSegments && unicodeScalars.contains {
            Self.semanticSeparators.contains($0)
        }
    }

    var hasValidSemanticSegments: Bool {
        let segments = components(separatedBy: Self.semanticSeparators)
        return !segments.isEmpty && segments.allSatisfy { segment in
            guard let first = segment.unicodeScalars.first,
                  Self.lowercaseLetters.contains(first) else { return false }
            var allowed = Self.lowercaseLetters
            allowed.formUnion(.decimalDigits)
            return segment.unicodeScalars.allSatisfy(allowed.contains)
        }
    }

    static let lowercaseLetters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz")
    static let semanticSeparators = CharacterSet(charactersIn: "._-")
}
