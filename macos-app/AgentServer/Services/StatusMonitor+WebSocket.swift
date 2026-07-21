import Foundation

extension StatusMonitor {
    func connectWebSocket() {
        guard isMonitoring, webSocketTask == nil else { return }
        guard let url = LocalServerEndpoint.webSocketURL(port: 47821) else { return }
        guard let request = try? LocalAPIAuthentication.authenticatedRequest(URLRequest(url: url)) else {
            localAPISetupError = Self.localAPISetupMessage
            scheduleWebSocketReconnect()
            return
        }
        webSocketGeneration += 1
        let generation = webSocketGeneration
        webSocketState.startedConnecting()

        let delegate = WebSocketOpenDelegate { [weak self] in
            Task { @MainActor [weak self] in
                guard let self,
                      generation == self.webSocketGeneration,
                      self.webSocketTask != nil else { return }
                self.webSocketState.confirmedOpen()
                self.localAPISetupError = nil
            }
        }
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        let task = session.webSocketTask(with: request)
        webSocketSession = session
        webSocketTask = task
        task.resume()
        receiveWebSocketMessage(generation: generation)
    }

    func disconnectWebSocket() {
        webSocketGeneration += 1
        webSocketReconnectTask?.cancel()
        webSocketReconnectTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil
        webSocketState.reset()
    }

    func resetWebSocketConnection() {
        disconnectWebSocket()
        connectWebSocket()
    }

    private func receiveWebSocketMessage(generation: Int) {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, generation == self.webSocketGeneration else { return }
                switch result {
                case .success(let message):
                    self.webSocketState.confirmedOpen()
                    self.handleWebSocketMessage(message)
                    self.receiveWebSocketMessage(generation: generation)
                case .failure:
                    self.webSocketTask = nil
                    self.webSocketSession?.invalidateAndCancel()
                    self.webSocketSession = nil
                    self.scheduleWebSocketReconnect()
                }
            }
        }
    }

    private func handleWebSocketMessage(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let event = try? JSONDecoder().decode(ProgressEvent.self, from: data) else { return }

        switch event.type {
        case .runStarted, .runSkipped:
            poll()
        case .runCompleted:
            notificationManager?.notifyRunCompleted(
                agentName: agentName(for: event.agentId),
                summary: event.summary
            )
            poll()
        case .runFailed:
            if event.code == "run_timeout" {
                notificationManager?.notifyRunTimedOut(agentName: agentName(for: event.agentId))
            } else {
                notificationManager?.notifyRunFailed(
                    agentName: agentName(for: event.agentId),
                    error: event.error ?? event.message
                )
            }
            poll()
        case .mcpStatus:
            let needsAuth = event.mcpNeedsAuthServers ?? []
            if !needsAuth.isEmpty { notificationManager?.notifyMcpNeedsAuth(serverNames: needsAuth) }
        case .runProgress, .unknown:
            break
        }
    }

    private func agentName(for agentId: String) -> String {
        agents.first(where: { $0.id == agentId })?.name ?? agentId
    }

    private func scheduleWebSocketReconnect() {
        guard isMonitoring, webSocketReconnectTask == nil else { return }
        let delay = webSocketState.recordFailure()
        let nanoseconds = UInt64(delay * 1_000_000_000)
        webSocketReconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled, let self else { return }
            self.webSocketReconnectTask = nil
            self.connectWebSocket()
        }
    }
}

private final class WebSocketOpenDelegate: NSObject, URLSessionWebSocketDelegate {
    private let onOpen: @Sendable () -> Void

    init(onOpen: @escaping @Sendable () -> Void) { self.onOpen = onOpen }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        onOpen()
    }
}

private enum ProgressEventType: String, Decodable {
    case runStarted = "run_started"
    case runProgress = "run_progress"
    case runCompleted = "run_completed"
    case runFailed = "run_failed"
    case runSkipped = "run_skipped"
    case mcpStatus = "mcp_status"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ProgressEventType(rawValue: raw) ?? .unknown
    }
}

private struct ProgressEvent: Decodable {
    let type: ProgressEventType
    let runId: String
    let agentId: String
    let timestamp: String
    let message: String?
    let error: String?
    let summary: String?
    let code: String?
    let mcpNeedsAuthServers: [String]?

    enum CodingKeys: String, CodingKey {
        case type, runId, agentId, timestamp, message, error, summary, code
        case mcpNeedsAuthServers = "mcp_needs_auth_servers"
    }
}
