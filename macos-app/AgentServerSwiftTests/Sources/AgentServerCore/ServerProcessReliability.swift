import Foundation

public enum LocalServerAction: Equatable, Sendable {
    case adoptExisting
    case keepExisting
    case replaceExisting
}

public enum LocalServerCompatibility {
    public static let requiredAPIVersion = 11

    public static func shouldReplace(apiVersion: Int?) -> Bool {
        guard let apiVersion else { return true }
        return apiVersion < requiredAPIVersion
    }

    public static func action(apiVersion: Int?, replacementIsReady: Bool) -> LocalServerAction {
        guard shouldReplace(apiVersion: apiVersion) else { return .adoptExisting }
        return replacementIsReady ? .replaceExisting : .keepExisting
    }
}

public enum NodeExecutableResolutionError: Error, Equatable, Sendable {
    case invalidOverride
    case notFound
}

public enum NodeExecutableResolver {
    public static let standardLocations = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]

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
            + standardLocations
        guard let executable = candidates.first(where: isExecutable) else {
            throw NodeExecutableResolutionError.notFound
        }
        return executable
    }
}

public enum ChildProcessPathBuilder {
    public static func build(inheritedPath: String, nodeExecutable: String) -> String {
        let nodeDirectory = URL(fileURLWithPath: nodeExecutable).deletingLastPathComponent().path
        let inheritedDirectories = inheritedPath
            .split(separator: ":", omittingEmptySubsequences: true)
            .map(String.init)
        let standardDirectories = NodeExecutableResolver.standardLocations.map {
            URL(fileURLWithPath: $0).deletingLastPathComponent().path
        }

        var seen = Set<String>()
        return ([nodeDirectory] + inheritedDirectories + standardDirectories)
            .filter { seen.insert($0).inserted }
            .joined(separator: ":")
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

public enum ExternalServerLookup {
    public static let timeoutSeconds = 2

    public static func arguments(port: UInt16) -> [String] {
        ["-nP", "-a", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
    }
}

public enum KernProcessEnvironmentParser {
    public static func parse(_ payload: [UInt8]) -> [String]? {
        guard payload.count >= MemoryLayout<Int32>.size else { return nil }
        let argumentCount = payload.prefix(MemoryLayout<Int32>.size).withUnsafeBytes {
            $0.loadUnaligned(as: Int32.self)
        }
        guard argumentCount >= 0, argumentCount <= payload.count else { return nil }

        var cursor = MemoryLayout<Int32>.size
        guard readString(from: payload, cursor: &cursor) != nil else { return nil }
        while cursor < payload.count, payload[cursor] == 0 {
            cursor += 1
        }
        for _ in 0..<argumentCount {
            guard readString(from: payload, cursor: &cursor) != nil else { return nil }
        }

        var environment: [String] = []
        while cursor < payload.count {
            if payload[cursor] == 0 {
                cursor += 1
                continue
            }
            guard let entry = readString(from: payload, cursor: &cursor) else { return nil }
            environment.append(entry)
        }
        return environment
    }

    private static func readString(from payload: [UInt8], cursor: inout Int) -> String? {
        guard cursor < payload.count,
              let end = payload[cursor...].firstIndex(of: 0) else {
            return nil
        }
        let value = String(decoding: payload[cursor..<end], as: UTF8.self)
        cursor = end + 1
        return value
    }
}

public struct ServerProcessIdentity: Codable, Equatable, Sendable {
    public let pid: Int32
    public let executablePath: String
    public let launchToken: String

    public init(pid: Int32, executablePath: String, launchToken: String) {
        self.pid = pid
        self.executablePath = executablePath
        self.launchToken = launchToken
    }

    public func matches(pid: Int32, executablePath: String, environment: [String]) -> Bool {
        guard self.pid == pid, self.executablePath == executablePath else { return false }
        let expectedToken = "AGENT_SERVER_LAUNCH_TOKEN=\(launchToken)"
        return environment.contains(expectedToken)
    }
}

public enum ServerShutdownAction: Equatable, Sendable {
    case complete
    case terminate
    case kill
    case identityMismatch
}

public enum ServerShutdownPolicy {
    public static func nextAction(
        isRunning: Bool,
        identityMatches: Bool,
        hasSentTerminate: Bool
    ) -> ServerShutdownAction {
        guard isRunning else { return .complete }
        guard identityMatches else { return .identityMismatch }
        return hasSentTerminate ? .kill : .terminate
    }
}

public struct ServerProcessLifecycle: Equatable, Sendable {
    public private(set) var shouldStopProcess = false
    public private(set) var canLaunchProcess = true

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

    public mutating func beginAppTermination() {
        canLaunchProcess = false
    }
}
