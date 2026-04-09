import Foundation

@MainActor
final class ServerProcessManager {
    private var serverProcess: Process?
    private var didStartServer = false

    private let healthURL = URL(string: "http://localhost:47821/health")!

    private static let locationKey = "AGENT_SERVER_LOCATION"

    private var serverDirectory: String? {
        // Precedence: 1) UserDefaults, 2) .env, 3) bundled, 4) bundle-adjacent
        if let configured = Self.configuredLocation() {
            let serverApp = (configured as NSString).appendingPathComponent("server-app")
            // Support pointing at the repo root or directly at server-app/
            let candidates = [serverApp, configured]
            if let match = candidates.first(where: { FileManager.default.fileExists(atPath: "\($0)/dist/cli.js") }) {
                return match
            }
            print("[ServerProcessManager] AGENT_SERVER_LOCATION is set but dist/cli.js not found at \(configured)")
        }

        let fallbacks = [bundledResourcePath, bundleAdjacentPath]
        return fallbacks.compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: "\($0)/dist/cli.js")
        }
    }

    static func configuredLocation() -> String? {
        if let fromDefaults = UserDefaults.standard.string(forKey: locationKey), !fromDefaults.isEmpty {
            return fromDefaults
        }

        let envPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/.env").path
        if let content = try? String(contentsOfFile: envPath, encoding: .utf8) {
            for line in content.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("#") || trimmed.isEmpty { continue }
                guard let eqIndex = trimmed.firstIndex(of: "=") else { continue }
                let key = String(trimmed[trimmed.startIndex..<eqIndex]).trimmingCharacters(in: .whitespaces)
                if key == locationKey {
                    var value = String(trimmed[trimmed.index(after: eqIndex)...]).trimmingCharacters(in: .whitespaces)
                    if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
                       (value.hasPrefix("'") && value.hasSuffix("'")) {
                        value = String(value.dropFirst().dropLast())
                    }
                    if !value.isEmpty { return value }
                }
            }
        }

        return nil
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

    private var nodePath: String {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) } ?? "node"
    }

    func startIfNeeded() async {
        let alreadyRunning = await isServerRunning()
        if alreadyRunning {
            didStartServer = false
            return
        }

        launchServer()
    }

    func stopIfWeStarted() {
        guard didStartServer, let process = serverProcess, process.isRunning else { return }
        process.terminate()
        serverProcess = nil
        didStartServer = false
    }

    func restart() async {
        if let process = serverProcess, process.isRunning {
            process.terminate()
            process.waitUntilExit()
            serverProcess = nil
            didStartServer = false
        }
        launchServer()
    }

    private func isServerRunning() async -> Bool {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 2
        let session = URLSession(configuration: config)

        do {
            let (_, response) = try await session.data(from: healthURL)
            guard let http = response as? HTTPURLResponse else { return false }
            return http.statusCode == 200
        } catch {
            return false
        }
    }

    private func launchServer() {
        guard let dir = serverDirectory else {
            print("[ServerProcessManager] Could not find agent-server directory with dist/cli.js")
            return
        }

        let cliPath = "\(dir)/dist/cli.js"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [cliPath, "start"]
        process.currentDirectoryURL = URL(fileURLWithPath: dir)

        var environment = ProcessInfo.processInfo.environment
        let envFilePath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/.env").path
        if let envVars = loadEnvVars(from: envFilePath) {
            for (key, value) in envVars where environment[key] == nil {
                environment[key] = value
            }
        }
        environment["PATH"] = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            environment["PATH"] ?? "",
        ].joined(separator: ":")

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
            didStartServer = true
            print("[ServerProcessManager] Started server (PID \(process.processIdentifier))")
        } catch {
            print("[ServerProcessManager] Failed to start server: \(error)")
        }
    }

    private func loadEnvVars(from path: String) -> [String: String]? {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            return nil
        }

        var vars: [String: String] = [:]
        for line in content.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            guard let eqIndex = trimmed.firstIndex(of: "=") else { continue }

            let key = String(trimmed[trimmed.startIndex..<eqIndex]).trimmingCharacters(in: .whitespaces)
            var value = String(trimmed[trimmed.index(after: eqIndex)...]).trimmingCharacters(in: .whitespaces)

            if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
               (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }

            vars[key] = value
        }
        return vars
    }
}
