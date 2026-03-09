import Foundation

@MainActor
final class ServerProcessManager {
    private var serverProcess: Process?
    private var didStartServer = false

    private let healthURL = URL(string: "http://localhost:47821/health")!

    private var serverDirectory: String? {
        let candidates = [
            bundleAdjacentPath,
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/Developer/saas-apps/agent-server",
        ]
        return candidates.compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: "\($0)/dist/cli.js")
        }
    }

    private var bundleAdjacentPath: String? {
        guard let bundlePath = Bundle.main.bundlePath as String? else { return nil }
        let appDir = (bundlePath as NSString).deletingLastPathComponent
        let candidate = (appDir as NSString).appendingPathComponent("agent-server")
        return FileManager.default.fileExists(atPath: candidate) ? candidate : nil
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

        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

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
