import Foundation

public struct AgentServerWorkspace: Equatable, Sendable {
    public let homeDirectory: URL

    public init(homeDirectory: URL) {
        self.homeDirectory = homeDirectory.standardizedFileURL
    }

    public static func `default`(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> AgentServerWorkspace {
        AgentServerWorkspace(homeDirectory: homeDirectory.appendingPathComponent(".agent-server"))
    }

    public var agentsDirectory: URL {
        homeDirectory.appendingPathComponent("agents", isDirectory: true)
    }

    public var environmentFile: URL {
        homeDirectory.appendingPathComponent(".env", isDirectory: false)
    }
}

public enum AgentServerWorkspaceStore {
    public static let homeDirectoryKey = "agentServer.homeDirectory"

    public static func current(
        defaults: UserDefaults = .standard,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> AgentServerWorkspace {
        guard let path = defaults.string(forKey: homeDirectoryKey), !path.isEmpty else {
            return .default(homeDirectory: homeDirectory)
        }
        return AgentServerWorkspace(homeDirectory: URL(fileURLWithPath: path, isDirectory: true))
    }

    public static func setHomeDirectory(_ url: URL, defaults: UserDefaults = .standard) {
        defaults.set(url.standardizedFileURL.path, forKey: homeDirectoryKey)
    }

    public static func restoreDefault(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: homeDirectoryKey)
    }
}
