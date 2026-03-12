import Foundation

actor AgentServerClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(port: Int = 47821) {
        self.baseURL = URL(string: "http://localhost:\(port)")!

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
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "agent_id", value: id)]
        let (data, response) = try await session.data(from: components.url!)
        try validateResponse(response)
        return try decoder.decode([Run].self, from: data)
    }

    func run(id: String) async throws -> Run {
        try await get("/runs/\(id)")
    }

    func cancelRun(id: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/runs/\(id)/cancel"))
        request.httpMethod = "POST"
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
