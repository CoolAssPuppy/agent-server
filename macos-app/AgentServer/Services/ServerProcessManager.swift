import Foundation
import Darwin

@MainActor
final class ServerProcessManager {
    private var serverProcess: Process?
    private var ownedIdentity: ServerProcessIdentity?
    private var shutdownTask: Task<Bool, Never>?
    private var lifecycle = ServerProcessLifecycle()
    private(set) var lastError: ServerProcessManagerError?

    private let healthURL = LocalServerEndpoint.httpURL(port: 47821)!
        .appendingPathComponent("health")

    private static let locationKey = "AGENT_SERVER_LOCATION"
    private static let nodePathKey = "AGENT_SERVER_NODE_PATH"
    private static let processIdentityKey = "AGENT_SERVER_OWNED_PROCESS_IDENTITY"
    private static let launchTokenKey = "AGENT_SERVER_LAUNCH_TOKEN"
    private static let terminationGracePeriod = Duration.seconds(2)
    private static let killGracePeriod = Duration.seconds(1)

    private var serverDirectory: String? {
        // Precedence: 1) UserDefaults, 2) .env, 3) bundled, 4) bundle-adjacent.
        // Each candidate is realpath-resolved before checking for dist/cli.js
        // so a symlink (whether user-placed or attacker-planted in a shared
        // tmp dir) cannot redirect the Node runtime to arbitrary JavaScript.
        if let configured = Self.configuredLocation() {
            let serverApp = (configured as NSString).appendingPathComponent("server-app")
            let candidates = [serverApp, configured]
            if let match = candidates
                .compactMap(Self.resolveRealPath)
                .first(where: { FileManager.default.fileExists(atPath: "\($0)/dist/cli.js") }) {
                return match
            }
            record(.invalidServerLocation)
        }

        let fallbacks = [bundledResourcePath, bundleAdjacentPath]
        return fallbacks
            .compactMap { $0 }
            .compactMap(Self.resolveRealPath)
            .first { FileManager.default.fileExists(atPath: "\($0)/dist/cli.js") }
    }

    /// Resolves a filesystem path to its canonical form (following symlinks).
    /// Returns nil if the path cannot be resolved, which is treated as "skip
    /// this candidate" by the caller. Using realpath(3) ensures we don't
    /// execute Node against a symlink target the current user didn't audit.
    private static func resolveRealPath(_ path: String) -> String? {
        guard let resolved = (path as NSString).resolvingSymlinksInPath as String? else {
            return nil
        }
        return resolved
    }

    static func configuredLocation() -> String? {
        configuredValue(forKey: locationKey)
    }

    private static func configuredValue(forKey key: String) -> String? {
        if let fromDefaults = UserDefaults.standard.string(forKey: key), !fromDefaults.isEmpty {
            return fromDefaults
        }
        if let inherited = ProcessInfo.processInfo.environment[key], !inherited.isEmpty {
            return inherited
        }
        return try? EnvFileStore.firstValue(forKey: key, from: EnvFileStore.configuredURLs())
    }

    static func setLocation(_ path: String?) {
        if let path {
            UserDefaults.standard.set(path, forKey: locationKey)
        } else {
            UserDefaults.standard.removeObject(forKey: locationKey)
        }
    }

    private var bundledResourcePath: String? {
        guard let resourcePath = Bundle.main.resourcePath else { return nil }
        return FileManager.default.fileExists(atPath: "\(resourcePath)/dist/cli.js") ? resourcePath : nil
    }

    private var bundleAdjacentPath: String? {
        guard let bundlePath = Bundle.main.bundlePath as String? else { return nil }
        let appDir = (bundlePath as NSString).deletingLastPathComponent
        let candidate = (appDir as NSString).appendingPathComponent("agent-server")
        return FileManager.default.fileExists(atPath: candidate) ? candidate : nil
    }

    private static func bundledEventKitHelperPath() -> String? {
        let bundlePath = Bundle.main.bundlePath
        let candidate = (bundlePath as NSString)
            .appendingPathComponent("Contents/Helpers/agent-server-eventkit")
        return FileManager.default.isExecutableFile(atPath: candidate) ? candidate : nil
    }

    func startIfNeeded() async {
        let health = await serverHealth()
        guard !Task.isCancelled else { return }
        if let health {
            guard LocalServerCompatibility.shouldReplace(apiVersion: health.apiVersion) else {
                lifecycle.observedExistingServer()
                return
            }

            let configuration = prepareLaunch()
            guard LocalServerCompatibility.action(
                apiVersion: health.apiVersion,
                replacementIsReady: configuration != nil
            ) == .replaceExisting,
                  let configuration else {
                lifecycle.observedExistingServer()
                return
            }
            await restart(using: configuration)
            return
        }

        guard let configuration = prepareLaunch() else { return }
        launchServer(using: configuration)
    }

    func stopIfWeStarted() async -> ServerProcessManagerError? {
        lifecycle.beginAppTermination()
        guard lifecycle.shouldStopProcess, let identity = ownedIdentity else { return nil }
        lastError = nil
        let didStop = await shutdownOnce(identity: identity)
        return didStop ? nil : lastError
    }

    func restart() async {
        guard let configuration = prepareLaunch() else { return }
        await restart(using: configuration)
    }

    private func restart(using configuration: ServerLaunchConfiguration) async {
        let didStop: Bool
        if let identity = ownedIdentity {
            didStop = await shutdownOnce(identity: identity)
        } else {
            didStop = await killExternalServer()
        }
        guard didStop, !Task.isCancelled, lifecycle.canLaunchProcess else { return }
        launchServer(using: configuration)
    }

    private func killExternalServer() async -> Bool {
        guard await isServerRunning() else { return true }

        do {
            let pids = try await Self.externalServerPIDs()
            try Task.checkCancellation()
            guard let identity = Self.storedProcessIdentity(), pids.contains(identity.pid) else {
                record(.externalProcessNotOwned)
                return false
            }
            let didStop = await shutdownOnce(identity: identity)
            return didStop
        } catch is CancellationError {
            return false
        } catch {
            record(.externalProcessLookupFailed)
            return false
        }
    }

    private func shutdownOnce(identity: ServerProcessIdentity) async -> Bool {
        if let shutdownTask {
            return await shutdownTask.value
        }
        let task = Task {
            let didStop = await self.shutdown(identity: identity)
            if didStop {
                self.clearOwnedProcess()
            }
            return didStop
        }
        shutdownTask = task
        let didStop = await task.value
        shutdownTask = nil
        return didStop
    }

    private func shutdown(identity: ServerProcessIdentity) async -> Bool {
        let initialAction = await shutdownAction(for: identity, hasSentTerminate: false)
        switch initialAction {
        case .complete:
            return true
        case .identityMismatch:
            record(.processIdentityMismatch)
            return false
        case .terminate:
            guard kill(identity.pid, SIGTERM) == 0 || errno == ESRCH else {
                record(.shutdownFailed)
                return false
            }
        case .kill:
            return false
        }

        if await Self.waitForExit(pid: identity.pid, timeout: Self.terminationGracePeriod) {
            return true
        }

        let escalationAction = await shutdownAction(for: identity, hasSentTerminate: true)
        switch escalationAction {
        case .complete:
            return true
        case .identityMismatch:
            record(.processIdentityMismatch)
            return false
        case .kill:
            guard kill(identity.pid, SIGKILL) == 0 || errno == ESRCH else {
                record(.shutdownFailed)
                return false
            }
        case .terminate:
            return false
        }

        guard await Self.waitForExit(pid: identity.pid, timeout: Self.killGracePeriod) else {
            record(.shutdownTimedOut)
            return false
        }
        return true
    }

    private func shutdownAction(
        for identity: ServerProcessIdentity,
        hasSentTerminate: Bool
    ) async -> ServerShutdownAction {
        let isRunning = Self.isProcessRunning(pid: identity.pid)
        let matches = isRunning ? await Self.processMatches(identity) : false
        return ServerShutdownPolicy.nextAction(
            isRunning: isRunning,
            identityMatches: matches,
            hasSentTerminate: hasSentTerminate
        )
    }

    private func isServerRunning() async -> Bool {
        await serverHealth() != nil
    }

    private func serverHealth() async -> HealthResponse? {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 2
        let session = URLSession(configuration: config)

        do {
            let (data, response) = try await session.data(from: healthURL)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(HealthResponse.self, from: data)
        } catch {
            return nil
        }
    }

    private func prepareLaunch() -> ServerLaunchConfiguration? {
        guard let dir = serverDirectory else {
            record(.serverDirectoryNotFound)
            return nil
        }

        var environment = ProcessInfo.processInfo.environment
        let childPath = environment["PATH"] ?? ""
        let nodePath: String
        do {
            nodePath = try NodeExecutableResolver.resolve(
                override: Self.configuredValue(forKey: Self.nodePathKey),
                path: childPath,
                isExecutable: FileManager.default.isExecutableFile(atPath:)
            )
        } catch NodeExecutableResolutionError.invalidOverride {
            record(.invalidNodeOverride)
            return nil
        } catch {
            record(.nodeNotFound)
            return nil
        }

        if let eventKitBin = Self.bundledEventKitHelperPath() {
            environment["AGENT_SERVER_EVENTKIT_BIN"] = eventKitBin
        }
        environment["PATH"] = ChildProcessPathBuilder.build(
            inheritedPath: childPath,
            nodeExecutable: nodePath,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
        environment["AGENT_SERVER_HOME"] = AgentServerWorkspaceStore.current().homeDirectory.path

        // Strip env vars that prevent the Agent SDK from spawning Claude Code
        environment.removeValue(forKey: "CLAUDECODE")

        return ServerLaunchConfiguration(
            serverDirectory: dir,
            nodeExecutable: nodePath,
            environment: environment
        )
    }

    private func launchServer(using configuration: ServerLaunchConfiguration) {
        guard lifecycle.canLaunchProcess else { return }
        let process = Process()
        let launchToken = UUID().uuidString
        var environment = configuration.environment
        environment[Self.launchTokenKey] = launchToken
        process.executableURL = URL(fileURLWithPath: configuration.nodeExecutable)
        process.arguments = ["\(configuration.serverDirectory)/dist/cli.js", "start"]
        process.currentDirectoryURL = URL(fileURLWithPath: configuration.serverDirectory)
        process.environment = environment

        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            let identity = ServerProcessIdentity(
                pid: process.processIdentifier,
                executablePath: Self.canonicalPath(configuration.nodeExecutable),
                launchToken: launchToken
            )
            serverProcess = process
            ownedIdentity = identity
            Self.storeProcessIdentity(identity)
            lifecycle.didLaunchServer()
            lastError = nil
        } catch {
            record(.launchFailed)
        }
    }

    private func clearOwnedProcess() {
        serverProcess = nil
        ownedIdentity = nil
        Self.storeProcessIdentity(nil)
        lifecycle.didStopServer()
    }

    private nonisolated static func externalServerPIDs() async throws -> [Int32] {
        try await Task.detached(priority: .utility) {
            try lookupExternalServerPIDs()
        }.value
    }

    private nonisolated static func lookupExternalServerPIDs() throws -> [Int32] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ExternalServerLookup.arguments(port: 47_821)
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        let didTerminate = DispatchSemaphore(value: 0)
        task.terminationHandler = { _ in didTerminate.signal() }
        try task.run()
        guard didTerminate.wait(
            timeout: .now() + .seconds(ExternalServerLookup.timeoutSeconds)
        ) == .success else {
            task.terminate()
            if didTerminate.wait(timeout: .now() + .milliseconds(250)) == .timedOut {
                kill(task.processIdentifier, SIGKILL)
                _ = didTerminate.wait(timeout: .now() + .milliseconds(250))
            }
            throw ExternalProcessLookupError.timedOut
        }
        guard task.terminationStatus == 0 || task.terminationStatus == 1 else {
            throw ExternalProcessLookupError.failed
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(decoding: data, as: UTF8.self)
        return ExternalProcessPIDParser.parse(output)
    }

    private nonisolated static func waitForExit(pid: Int32, timeout: Duration) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            if !isProcessRunning(pid: pid) { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return !isProcessRunning(pid: pid)
    }

    private nonisolated static func isProcessRunning(pid: Int32) -> Bool {
        guard kill(pid, 0) != 0 else { return true }
        return errno == EPERM
    }

    private nonisolated static func processMatches(_ identity: ServerProcessIdentity) async -> Bool {
        await Task.detached(priority: .utility) {
            guard let executablePath = executablePath(pid: identity.pid),
                  let environment = processArgumentsAndEnvironment(pid: identity.pid) else {
                return false
            }
            return identity.matches(
                pid: identity.pid,
                executablePath: canonicalPath(executablePath),
                environment: environment
            )
        }.value
    }

    private nonisolated static func executablePath(pid: Int32) -> String? {
        var buffer = [CChar](repeating: 0, count: 4_096)
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }
        return String(cString: buffer)
    }

    private nonisolated static func processArgumentsAndEnvironment(pid: Int32) -> [String]? {
        var mib = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, UInt32(mib.count), nil, &size, nil, 0) == 0,
              size > 0,
              size <= 4 * 1_024 * 1_024 else {
            return nil
        }
        var bytes = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, UInt32(mib.count), &bytes, &size, nil, 0) == 0 else {
            return nil
        }
        return KernProcessEnvironmentParser.parse(Array(bytes.prefix(size)))
    }

    private nonisolated static func canonicalPath(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }

    private static func storedProcessIdentity() -> ServerProcessIdentity? {
        guard let data = UserDefaults.standard.data(forKey: processIdentityKey) else { return nil }
        return try? JSONDecoder().decode(ServerProcessIdentity.self, from: data)
    }

    private static func storeProcessIdentity(_ identity: ServerProcessIdentity?) {
        guard let identity else {
            UserDefaults.standard.removeObject(forKey: processIdentityKey)
            return
        }
        if let data = try? JSONEncoder().encode(identity) {
            UserDefaults.standard.set(data, forKey: processIdentityKey)
        }
    }

    private func record(_ error: ServerProcessManagerError) {
        lastError = error
        print("[ServerProcessManager] \(error.localizedDescription)")
    }
}

private enum ExternalProcessLookupError: Error {
    case failed
    case timedOut
}

private struct ServerLaunchConfiguration {
    let serverDirectory: String
    let nodeExecutable: String
    let environment: [String: String]
}

enum ServerProcessManagerError: LocalizedError, Equatable {
    case invalidServerLocation
    case serverDirectoryNotFound
    case invalidNodeOverride
    case nodeNotFound
    case launchFailed
    case externalProcessLookupFailed
    case externalProcessNotOwned
    case processIdentityMismatch
    case shutdownFailed
    case shutdownTimedOut

    var errorDescription: String? {
        switch self {
        case .invalidServerLocation:
            return "The configured server location does not contain a built server."
        case .serverDirectoryNotFound:
            return "The local server directory could not be found."
        case .invalidNodeOverride:
            return "The configured Node executable is not available."
        case .nodeNotFound:
            return "Node could not be found in the child process PATH."
        case .launchFailed:
            return "The local server could not be started."
        case .externalProcessLookupFailed:
            return "The existing local server process could not be inspected."
        case .externalProcessNotOwned:
            return "The existing local server was not started by this app and was left running."
        case .processIdentityMismatch:
            return "The local server process changed before it could be stopped and was left running."
        case .shutdownFailed:
            return "The local server process could not be stopped."
        case .shutdownTimedOut:
            return "The local server process did not stop before the shutdown deadline."
        }
    }
}
