import Foundation

actor AgentServerClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let environmentURLs: [URL]

    init(port: Int = 47821, environmentURL: URL? = nil) {
        // Fail loud during init with a clear message if the host/port combo
        // ever produces an invalid URL — better than a force-unwrap crash
        // miles away in the call site.
        guard let url = LocalServerEndpoint.httpURL(port: port) else {
            preconditionFailure("AgentServerClient: invalid base URL for port \(port)")
        }
        self.baseURL = url
        self.environmentURLs = environmentURL.map { [$0] }
            ?? LocalAPIAuthentication.defaultEnvironmentURLs()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func health() async throws -> HealthResponse {
        try await get("/health", requiresAuthentication: false)
    }

    func agents() async throws -> [Agent] {
        try await get("/agents")
    }

    func runs() async throws -> [Run] {
        try await get("/runs")
    }

    func runsForAgent(id: String) async throws -> [Run] {
        let url = baseURL.appendingPathComponent("/runs")
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw ClientError.invalidResponse
        }
        components.queryItems = [URLQueryItem(name: "agent_id", value: id)]
        guard let composed = components.url else {
            throw ClientError.invalidResponse
        }
        let request = try authenticatedRequest(URLRequest(url: composed))
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode([Run].self, from: data)
    }

    func run(id: String) async throws -> Run {
        try await get("/runs/\(id)")
    }

    /// Pending decisions the daemon learned about over Supabase Realtime. The
    /// daemon serves these locally so the app never polls the panel for them.
    /// Uses a fractional-seconds-tolerant decoder because Postgres timestamps
    /// carry sub-second precision that the default `.iso8601` strategy rejects.
    func fetchPendingDecisions() async throws -> [Decision] {
        let url = baseURL.appendingPathComponent("/decisions")
        let request = try authenticatedRequest(URLRequest(url: url))
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try Self.decisionDecoder.decode(DecisionsResponse.self, from: data).decisions
    }

    private static let decisionDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: dateString) { return date }

            iso.formatOptions = [.withInternetDateTime]
            if let date = iso.date(from: dateString) { return date }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date: \(dateString)"
            )
        }
        return decoder
    }()

    func cancelRun(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/runs/\(id)/cancel"))
        request.httpMethod = "POST"
        request = try authenticatedRequest(request)
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    func deleteRun(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/runs/\(id)"))
        request.httpMethod = "DELETE"
        request = try authenticatedRequest(request)
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    func cleanupStaleRuns() async throws -> CleanupResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("/cleanup"))
        request.httpMethod = "POST"
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(CleanupResponse.self, from: data)
    }

    /// Applies a structured patch to an agent definition via the server's
    /// PUT /agents/:id route. Values use JSON conventions: NSNull() removes
    /// a field, and a "capabilities" array of {id, enabled} objects toggles
    /// capabilities. The server writes the YAML/markdown file losslessly.
    func updateAgent(id: String, patch: [String: Any]) async throws -> Agent {
        var request = URLRequest(url: baseURL.appendingPathComponent("/agents/\(id)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: patch)
        request = try authenticatedRequest(request)

        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(Agent.self, from: data)
    }

    /// Convenience for a single capability toggle.
    func setCapability(agentId: String, capabilityId: String, enabled: Bool) async throws -> Agent {
        try await updateAgent(
            id: agentId,
            patch: ["capabilities": [["id": capabilityId, "enabled": enabled]]]
        )
    }

    func createAgent(
        name: String,
        description: String?,
        prompt: String,
        schedule: String?,
        capabilities: [(id: String, enabled: Bool)]
    ) async throws -> Agent {
        var body: [String: Any] = ["name": name, "prompt": prompt]
        if let description, !description.isEmpty { body["description"] = description }
        if let schedule, !schedule.isEmpty { body["schedule"] = schedule }
        if !capabilities.isEmpty {
            body["capabilities"] = capabilities.map { ["id": $0.id, "enabled": $0.enabled] }
        }

        var request = URLRequest(url: baseURL.appendingPathComponent("/agents"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request = try authenticatedRequest(request)

        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(Agent.self, from: data)
    }

    func deleteAgent(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/agents/\(id)"))
        request.httpMethod = "DELETE"
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
    }

    func capabilityCatalog() async throws -> [CapabilityCatalogEntry] {
        let response: CapabilityCatalogResponse = try await get("/capabilities")
        return response.capabilities
    }

    /// The cached set of connectors the Claude runtime can reach. Read-only;
    /// call `refreshConnections()` to force a fresh probe.
    func connections() async throws -> ConnectionSnapshot {
        try await get("/connections")
    }

    func securityAnalysis(agentId: String) async throws -> SecurityAnalysisPayload {
        try await securityRequest(.agent(agentId))
    }

    func scanSecurity() async throws -> SecurityScanPayload {
        try await securityRequest(.scan)
    }

    func markSecurityReviewed(
        agentId: String,
        contentHash: String,
        acknowledgedFindingIds: [String]
    ) async throws -> SecurityReviewResponse {
        let body = SecurityReviewRequestPayload(
            contentHash: contentHash,
            acknowledgedFindingIds: acknowledgedFindingIds
        )
        return try await securityRequest(.review(agentId), body: body)
    }

    /// Re-probes the runtime and returns the fresh snapshot. Backs the
    /// "Refresh connections" action; costs an MCP connection, no tokens.
    func refreshConnections() async throws -> ConnectionSnapshot {
        var request = URLRequest(url: baseURL.appendingPathComponent("/connections/refresh"))
        request.httpMethod = "POST"
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(ConnectionSnapshot.self, from: data)
    }

    /// Write routes return structured errors (message + missing env vars for
    /// connection capabilities); surface those instead of a bare status code.
    private func validateWriteResponse(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard !(200...299).contains(httpResponse.statusCode) else { return }

        if let body = try? decoder.decode(AgentWriteErrorBody.self, from: data) {
            throw ClientError.writeFailed(
                message: body.error,
                missingEnv: body.missingEnv ?? []
            )
        }
        throw ClientError.httpError(statusCode: httpResponse.statusCode)
    }

    func triggerRun(agentId: String, with context: String? = nil) async throws -> TriggerResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("/agents/\(agentId)/run"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let context {
            let body = ["with": context]
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        request = try authenticatedRequest(request)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(TriggerResponse.self, from: data)
    }

    private func get<T: Decodable>(
        _ path: String,
        requiresAuthentication: Bool = true
    ) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        let initialRequest = URLRequest(url: url)
        let request = requiresAuthentication
            ? try authenticatedRequest(initialRequest)
            : initialRequest
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func securityRequest<Response: Decodable>(
        _ route: SecurityServerRoute
    ) async throws -> Response {
        try await securityRequest(route, bodyData: nil)
    }

    private func securityRequest<Response: Decodable, Body: Encodable>(
        _ route: SecurityServerRoute,
        body: Body
    ) async throws -> Response {
        try await securityRequest(route, bodyData: JSONEncoder().encode(body))
    }

    private func securityRequest<Response: Decodable>(
        _ route: SecurityServerRoute,
        bodyData: Data?
    ) async throws -> Response {
        guard let url = URL(string: route.path, relativeTo: baseURL)?.absoluteURL else {
            throw ClientError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = route.method.rawValue
        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(Response.self, from: data)
    }

    private func authenticatedRequest(_ request: URLRequest) throws -> URLRequest {
        do {
            return try LocalAPIAuthentication.authenticatedRequest(
                request,
                environmentURLs: environmentURLs
            )
        } catch LocalAPIAuthenticationError.missingAPIKey {
            throw ClientError.missingLocalAPIKey
        } catch {
            // File access and parse failures are also local authentication
            // setup problems. Keep them distinct from transport reachability.
            throw ClientError.missingLocalAPIKey
        }
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw ClientError.httpError(statusCode: httpResponse.statusCode)
        }
    }
}

struct AgentWriteErrorBody: Decodable {
    let error: String
    let missingEnv: [String]?

    enum CodingKeys: String, CodingKey {
        case error
        case missingEnv = "missing_env"
    }
}

enum ClientError: LocalizedError {
    case invalidResponse
    case missingLocalAPIKey
    case httpError(statusCode: Int)
    case writeFailed(message: String, missingEnv: [String])

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .missingLocalAPIKey:
            return "Agent Server needs to finish its secure local setup. Restart the server and try again."
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .writeFailed(let message, _):
            return message
        }
    }

    /// Env vars a capability needs before it can be enabled; empty when the
    /// failure was not a missing-connection problem.
    var missingEnvVars: [String] {
        if case .writeFailed(_, let missingEnv) = self { return missingEnv }
        return []
    }
}
