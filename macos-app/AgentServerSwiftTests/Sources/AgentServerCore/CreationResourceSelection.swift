import Foundation

public struct CreationResourceCandidate: Equatable, Sendable {
    public let path: String
    public let isDirectory: Bool

    public init(path: String, isDirectory: Bool) {
        self.path = path
        self.isDirectory = isDirectory
    }
}

public enum CreationResourceSelectionError: Error, Equatable, Sendable {
    case folderRequired

    public var message: String {
        switch self {
        case .folderRequired: "Choose a folder, not a file."
        }
    }
}

public struct CreationResourceSelection: Equatable, Sendable {
    public private(set) var grants: [CreationFileGrant]

    public init(grants: [CreationFileGrant] = []) {
        self.grants = grants
    }

    public static func folderPath(
        from candidates: [CreationResourceCandidate]
    ) -> Result<String, CreationResourceSelectionError> {
        guard candidates.count == 1, let candidate = candidates.first, candidate.isDirectory else {
            return .failure(.folderRequired)
        }
        return .success(candidate.path)
    }

    @discardableResult
    public mutating func add(
        _ candidates: [CreationResourceCandidate],
        mode: CreationResourcePickerMode
    ) -> CreationResourceSelectionError? {
        guard candidates.allSatisfy({ mode.accepts(isDirectory: $0.isDirectory) }) else {
            return .folderRequired
        }
        var knownPaths = Set(grants.map(\.path))
        for candidate in candidates where knownPaths.insert(candidate.path).inserted {
            grants.append(CreationFileGrant(
                path: candidate.path,
                kind: candidate.isDirectory ? .folder : .file,
                access: .readOnly
            ))
        }
        return nil
    }

    public mutating func setAccess(_ access: CreationFileGrant.Access, for path: String) {
        guard let index = grants.firstIndex(where: { $0.path == path }) else { return }
        let grant = grants[index]
        grants[index] = CreationFileGrant(path: grant.path, kind: grant.kind, access: access)
    }

    public mutating func remove(path: String) {
        grants.removeAll { $0.path == path }
    }
}
