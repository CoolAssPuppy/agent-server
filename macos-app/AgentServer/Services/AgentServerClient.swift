import Foundation

actor AgentServerClient {
    private let baseURL: URL
    private let session: URLSession
    private let longRunningSession: URLSession
    private let decoder: JSONDecoder
    private let environmentURLs: [URL]?

    init(port: Int = 47821, environmentURL: URL? = nil) {
        // Fail loud during init with a clear message if the host/port combo
        // ever produces an invalid URL. This is better than a force-unwrap crash
        // miles away in the call site.
        guard let url = LocalServerEndpoint.httpURL(port: port) else {
            preconditionFailure("AgentServerClient: invalid base URL for port \(port)")
        }
        self.baseURL = url
        self.environmentURLs = environmentURL.map { [$0] }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)

        let longRunningConfig = URLSessionConfiguration.default
        longRunningConfig.timeoutIntervalForRequest = 75
        longRunningConfig.timeoutIntervalForResource = 90
        self.longRunningSession = URLSession(configuration: longRunningConfig)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func health() async throws -> HealthResponse {
        try await get("/health", requiresAuthentication: false)
    }

    func machine() async throws -> MachineResponse {
        try await get(LocalServerEndpoint.machinePath)
    }

    func agents() async throws -> [Agent] {
        try await get("/agents")
    }

    func agentRuntime(id: String) async throws -> AgentRuntimeAssignmentResponse {
        try await get("/agents/\(id)/runtime")
    }

    func runtimeCompatibility(
        id: String,
        executor: String
    ) async throws -> AgentRuntimeCompatibility {
        try await get(
            "/agents/\(id)/runtime-compatibility",
            queryItems: [URLQueryItem(name: "executor", value: executor)]
        )
    }

    func updateAgentRuntime(
        id: String,
        request: AgentRuntimeAssignmentRequest
    ) async throws -> AgentRuntimeAssignmentResponse {
        try await routeRequest(
            path: "/agents/\(id)/runtime",
            method: .put,
            bodyData: try JSONEncoder().encode(request),
            usesGuidanceErrors: true
        )
    }

    func agentBindings(id: String) async throws -> AgentBindingSetResponse {
        try await get("/agents/\(id)/bindings")
    }

    func updateAgentBindings(
        id: String,
        request: AgentBindingSetRequest
    ) async throws -> AgentBindingSetResponse {
        try await routeRequest(
            path: "/agents/\(id)/bindings",
            method: .put,
            bodyData: try JSONEncoder().encode(request),
            usesGuidanceErrors: true
        )
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

    func runReview(id: String) async throws -> RunReview {
        try await get(LocalServerEndpoint.runReviewPath(runID: id))
    }

    func todayActivitySnapshot() async throws -> TodayActivitySnapshot {
        try await get(LocalServerEndpoint.todayActivityPath)
    }

    func assistantHome(id: String) async throws -> AssistantHomeContract {
        try await get(LocalServerEndpoint.assistantHomePath(assistantID: id))
    }

    func interaction(id: String) async throws -> LocalInteraction {
        try await get(LocalServerEndpoint.interactionPath(interactionID: id))
    }

    func replyToInteraction(
        id: String,
        reply: LocalInteractionReply
    ) async throws -> InteractionReplyAcceptance {
        try await routeRequest(
            path: LocalServerEndpoint.interactionReplyPath(interactionID: id),
            method: .post,
            bodyData: try JSONEncoder().encode(reply)
        )
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

    func slackPairingStatus() async throws -> SlackPairingStatus {
        try await get(LocalServerEndpoint.slackPairingPath)
    }

    func pairSlack(channelID: String) async throws -> SlackPairingStatus {
        try await routeRequest(
            path: LocalServerEndpoint.slackPairingPath,
            method: .put,
            bodyData: try JSONEncoder().encode(SlackDestinationRequest(channelID: channelID))
        )
    }

    func testSlack() async throws -> SlackTestMessageResponse {
        try await routeRequest(
            path: LocalServerEndpoint.slackPairingTestPath,
            method: .post
        )
    }

    /// The cached set of connectors the Claude runtime can reach. Read-only;
    /// call `refreshConnections()` to force a fresh probe.
    func connections() async throws -> ConnectionSnapshot {
        try await get("/connections")
    }

    /// Consumer-facing connection instances from MCP accounts, configured APIs,
    /// and reusable local services. The response never includes credentials.
    func services(executor: String? = nil) async throws -> GuidanceServiceRegistryResponse {
        let queryItems = executor.map { [URLQueryItem(name: "executor", value: $0)] } ?? []
        return try await get("/services", queryItems: queryItems)
    }

    /// User-named reusable connections saved independently from any agent.
    /// Profiles contain credential references, never credential values.
    func connectionProfiles() async throws -> [ConnectionProfile] {
        let response: ConnectionProfileListResponse = try await get("/connection-profiles")
        return response.connections
    }

    /// Saves a reusable connection profile. Secret values are persisted locally
    /// before this call and are deliberately absent from the request model.
    func createConnectionProfile(
        _ requestBody: ConnectionProfileCreateRequest
    ) async throws -> ConnectionProfile {
        var request = URLRequest(url: baseURL.appendingPathComponent("/connection-profiles"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)
        request = try authenticatedRequest(request)

        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(ConnectionProfile.self, from: data)
    }

    func renameConnectionProfile(id: String, label: String) async throws -> ConnectionProfile {
        var request = URLRequest(url: baseURL.appendingPathComponent("/connection-profiles/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ConnectionLabelRequest(label: label))
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(ConnectionProfile.self, from: data)
    }

    func duplicateConnectionProfile(id: String, label: String) async throws -> ConnectionProfile {
        var request = URLRequest(
            url: baseURL.appendingPathComponent("/connection-profiles/\(id)/duplicate")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ConnectionLabelRequest(label: label))
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(ConnectionProfile.self, from: data)
    }

    func checkConnectionProfile(id: String) async throws -> ConnectionReadinessResponse {
        var request = URLRequest(
            url: baseURL.appendingPathComponent("/connection-profiles/\(id)/check")
        )
        request.httpMethod = "POST"
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        return try decoder.decode(ConnectionReadinessResponse.self, from: data)
    }

    func connectionOperationReview(id: String) async throws -> ConnectionOperationReviewResponse {
        try await get("/connection-profiles/\(id)/operations")
    }

    func updateConnectionOperationMappings(
        id: String,
        requestBody: ConnectionOperationMappingRequest
    ) async throws -> ConnectionOperationReviewResponse {
        var request = URLRequest(
            url: baseURL.appendingPathComponent("/connection-profiles/\(id)/operations")
        )
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        try validateWriteResponse(data: data, response: response)
        _ = try decoder.decode(ConnectionOperationMappingSaveResponse.self, from: data)
        return try await connectionOperationReview(id: id)
    }

    func removeConnectionProfile(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/connection-profiles/\(id)"))
        request.httpMethod = "DELETE"
        request = try authenticatedRequest(request)
        let (data, response) = try await session.data(for: request)
        if let httpResponse = response as? HTTPURLResponse,
           httpResponse.statusCode == 409,
           let conflict = try? decoder.decode(ConnectionRemovalConflict.self, from: data) {
            throw ClientError.connectionInUse(conflict.consumerExplanation)
        }
        try validateWriteResponse(data: data, response: response)
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
        request.timeoutInterval = 75
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let context {
            let body = ["with": context]
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        request = try authenticatedRequest(request)

        let (data, response) = try await longRunningSession.data(for: request)
        try validateTriggerResponse(data: data, response: response)
        return try decoder.decode(TriggerResponse.self, from: data)
    }

    private func validateTriggerResponse(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard !(200...299).contains(httpResponse.statusCode) else { return }

        if let body = try? decoder.decode(RunTriggerErrorBody.self, from: data) {
            throw ClientError.runTriggerFailed(
                message: body.error,
                code: body.code,
                missingEnv: body.missingEnv ?? []
            )
        }
        throw ClientError.httpError(statusCode: httpResponse.statusCode)
    }

    private func get<T: Decodable>(
        _ path: String,
        queryItems: [URLQueryItem] = [],
        requiresAuthentication: Bool = true
    ) async throws -> T {
        let pathURL = baseURL.appendingPathComponent(path)
        guard var components = URLComponents(url: pathURL, resolvingAgainstBaseURL: false) else {
            throw ClientError.invalidResponse
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { throw ClientError.invalidResponse }
        let initialRequest = URLRequest(url: url)
        let request = requiresAuthentication
            ? try authenticatedRequest(initialRequest)
            : initialRequest
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    func routeRequest<Response: Decodable>(
        path: String,
        method: HTTPRequestMethod,
        bodyData: Data? = nil,
        usesGuidanceErrors: Bool = false,
        timeoutInterval: TimeInterval? = nil
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ClientError.invalidResponse
        }
        var request = URLRequest(url: url)
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.httpMethod = method.rawValue
        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }
        request = try authenticatedRequest(request)
        let requestSession = timeoutInterval == nil ? session : longRunningSession
        let (data, response) = try await requestSession.data(for: request)
        if usesGuidanceErrors {
            try validateGuidanceResponse(data: data, response: response)
        } else {
            try validateResponse(response)
        }
        return try decoder.decode(Response.self, from: data)
    }

    private func validateGuidanceResponse(data: Data, response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard !(200...299).contains(response.statusCode) else { return }
        if let body = try? decoder.decode(GuidanceErrorBody.self, from: data) {
            throw ClientError.writeFailed(message: body.error, missingEnv: [])
        }
        throw ClientError.httpError(statusCode: response.statusCode)
    }

    private func authenticatedRequest(_ request: URLRequest) throws -> URLRequest {
        let resolvedEnvironmentURLs = environmentURLs
            ?? LocalAPIAuthentication.defaultEnvironmentURLs()
        do {
            return try LocalAPIAuthentication.authenticatedRequest(
                request,
                environmentURLs: resolvedEnvironmentURLs
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

private struct RunTriggerErrorBody: Decodable {
    let error: String
    let code: String?
    let missingEnv: [String]?

    enum CodingKeys: String, CodingKey {
        case error, code
        case missingEnv = "missing_env"
    }
}

private struct GuidanceErrorBody: Decodable {
    let error: String
}

enum ClientError: LocalizedError {
    case invalidResponse
    case notFound
    case missingLocalAPIKey
    case httpError(statusCode: Int)
    case writeFailed(message: String, missingEnv: [String])
    case runTriggerFailed(message: String, code: String?, missingEnv: [String])
    case connectionInUse(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .notFound:
            return "The requested item was not found."
        case .missingLocalAPIKey:
            return "Agent Server needs to finish its secure local setup. Restart the server and try again."
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .connectionInUse(let message):
            return message
        case .writeFailed(let message, _):
            return message
        case .runTriggerFailed(let message, _, _):
            return message
        }
    }

    /// Env vars a capability needs before it can be enabled; empty when the
    /// failure was not a missing-connection problem.
    var missingEnvVars: [String] {
        switch self {
        case .writeFailed(_, let missingEnv), .runTriggerFailed(_, _, let missingEnv):
            return missingEnv
        case .connectionInUse:
            return []
        default:
            return []
        }
    }
}
