import Foundation

@MainActor
final class ServerProcessManager {
    private var serverProcess: Process?
    private var lifecycle = ServerProcessLifecycle()
    private(set) var lastError: ServerProcessManagerError?

    private let healthURL = LocalServerEndpoint.httpURL(port: 47821)!
        .appendingPathComponent("health")

    private static let locationKey = "AGENT_SERVER_LOCATION"
    private static let nodePathKey = "AGENT_SERVER_NODE_PATH"

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
        return try? EnvFileStore.firstValue(forKey: key, from: EnvFileStore.defaultURLs())
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
            if LocalServerCompatibility.shouldReplace(apiVersion: health.apiVersion) {
                await restart()
                return
            }
            lifecycle.observedExistingServer()
            return
        }

        launchServer()
    }

    func stopIfWeStarted() {
        guard lifecycle.shouldStopProcess, let process = serverProcess, process.isRunning else { return }
        process.terminate()
        serverProcess = nil
        lifecycle.didStopServer()
    }

    func restart() async {
        if let process = serverProcess, process.isRunning {
            process.terminate()
            await Self.waitUntilExit(process)
            serverProcess = nil
            lifecycle.didStopServer()
        } else {
            await killExternalServer()
        }
        guard !Task.isCancelled else { return }
        launchServer()
    }

    private func killExternalServer() async {
        guard await isServerRunning() else { return }

        do {
            let pids = try await Self.externalServerPIDs()
            try Task.checkCancellation()
            for pid in pids {
                kill(pid, SIGTERM)
            }
            try? await Task.sleep(for: .seconds(1))
        } catch is CancellationError {
            return
        } catch {
            record(.externalProcessLookupFailed)
        }
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

    private func launchServer() {
        guard let dir = serverDirectory else {
            record(.serverDirectoryNotFound)
            return
        }

        let cliPath = "\(dir)/dist/cli.js"

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
            return
        } catch {
            record(.nodeNotFound)
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [cliPath, "start"]
        process.currentDirectoryURL = URL(fileURLWithPath: dir)

        if let eventKitBin = Self.bundledEventKitHelperPath() {
            environment["AGENT_SERVER_EVENTKIT_BIN"] = eventKitBin
        }

        // Strip env vars that prevent the Agent SDK from spawning Claude Code
        environment.removeValue(forKey: "CLAUDECODE")

        process.environment = environment

        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            serverProcess = process
            lifecycle.didLaunchServer()
            lastError = nil
        } catch {
            record(.launchFailed)
        }
    }

    private nonisolated static func waitUntilExit(_ process: Process) async {
        await Task.detached(priority: .utility) {
            process.waitUntilExit()
        }.value
    }

    private nonisolated static func externalServerPIDs() async throws -> [Int32] {
        try await Task.detached(priority: .utility) {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: ExternalProcessInspector.executablePath)
            task.arguments = ["-ti", "tcp:47821"]
            let pipe = Pipe()
            task.standardOutput = pipe
            task.standardError = FileHandle.nullDevice
            try task.run()
            task.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(decoding: data, as: UTF8.self)
            return ExternalProcessPIDParser.parse(output)
        }.value
    }

    private func record(_ error: ServerProcessManagerError) {
        lastError = error
        print("[ServerProcessManager] \(error.localizedDescription)")
    }
}

enum ServerProcessManagerError: LocalizedError, Equatable {
    case invalidServerLocation
    case serverDirectoryNotFound
    case invalidNodeOverride
    case nodeNotFound
    case launchFailed
    case externalProcessLookupFailed

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
        }
    }
}
