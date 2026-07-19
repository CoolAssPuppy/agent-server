import Foundation

public enum LocalServerCompatibility {
    public static let requiredAPIVersion = 6

    public static func shouldReplace(apiVersion: Int?) -> Bool {
        guard let apiVersion else { return true }
        return apiVersion < requiredAPIVersion
    }
}

public enum NodeExecutableResolutionError: Error, Equatable, Sendable {
    case invalidOverride
    case notFound
}

public enum NodeExecutableResolver {
    public static func resolve(
        override: String?,
        path: String,
        isExecutable: (String) -> Bool
    ) throws -> String {
        if let override, !override.isEmpty {
            guard isExecutable(override) else {
                throw NodeExecutableResolutionError.invalidOverride
            }
            return override
        }

        let candidates = path
            .split(separator: ":", omittingEmptySubsequences: true)
            .map { URL(fileURLWithPath: String($0)).appendingPathComponent("node").path }
        guard let executable = candidates.first(where: isExecutable) else {
            throw NodeExecutableResolutionError.notFound
        }
        return executable
    }
}

public enum ExternalProcessPIDParser {
    public static func parse(_ output: String) -> [Int32] {
        let digits = CharacterSet.decimalDigits
        var seen: Set<Int32> = []
        return output.components(separatedBy: .newlines).compactMap { line in
            let value = line.trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty,
                  value.unicodeScalars.allSatisfy(digits.contains),
                  let pid = Int32(value),
                  pid > 0,
                  seen.insert(pid).inserted else {
                return nil
            }
            return pid
        }
    }
}

public struct ServerProcessLifecycle: Equatable, Sendable {
    public private(set) var shouldStopProcess = false

    public init() {}

    public mutating func observedExistingServer() {
        shouldStopProcess = false
    }

    public mutating func didLaunchServer() {
        shouldStopProcess = true
    }

    public mutating func didStopServer() {
        shouldStopProcess = false
    }
}
