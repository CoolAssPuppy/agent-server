import Foundation

actor AgentServerClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(port: Int = 47821) {
        // Fail loud during init with a clear message if the host/port combo
        // ever produces an invalid URL — better than a force-unwrap crash
        // miles away in the call site.
        guard let url = LocalServerEndpoint.httpURL(port: port) else {
            preconditionFailure("AgentServerClient: invalid base URL for port \(port)")
        }
        self.baseURL = url

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func health() async throws -> HealthResponse {
        try await get("/health")
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
        let (data, response) = try await session.data(from: composed)
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
        let (data, response) = try await session.data(from: url)
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
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    func deleteRun(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/runs/\(id)"))
        request.httpMethod = "DELETE"
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    func cleanupStaleRuns() async throws -> CleanupResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("/cleanup"))
        request.httpMethod = "POST"
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(CleanupResponse.self, from: data)
    }

    func triggerRun(agentId: String, with context: String? = nil) async throws -> TriggerResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("/agents/\(agentId)/run"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let context {
            let body = ["with": context]
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(TriggerResponse.self, from: data)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        let (data, response) = try await session.data(from: url)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
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

enum ClientError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        }
    }
}
