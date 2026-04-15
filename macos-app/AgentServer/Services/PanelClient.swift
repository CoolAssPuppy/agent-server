import Foundation

actor PanelClient {
    private let baseURL: URL
    private let apiKey: String
    private let session: URLSession
    private let decoder: JSONDecoder

    init?(panelURL: String, apiKey: String) {
        guard !panelURL.isEmpty, !apiKey.isEmpty,
              let url = URL(string: panelURL) else {
            return nil
        }
        self.baseURL = url
        self.apiKey = apiKey

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        self.session = URLSession(configuration: config)

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
        self.decoder = decoder
    }

    static func fromEnv() -> PanelClient? {
        let env = EnvFile.load()
        let url = env.entries.first { $0.key == "AGENT_SERVER_PANEL_URL" }?.value ?? ""
        let key = env.entries.first { $0.key == "AGENT_SERVER_PANEL_API_KEY" }?.value ?? ""
        return PanelClient(panelURL: url, apiKey: key)
    }

    func fetchRun(id: String) async throws -> PanelRun? {
        let url = baseURL.appendingPathComponent("/api/runs/\(id)")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        if http.statusCode == 404 { return nil }
        guard (200...299).contains(http.statusCode) else {
            throw ClientError.httpError(statusCode: http.statusCode)
        }

        let parsed = try decoder.decode(PanelRunResponse.self, from: data)
        return parsed.run
    }

    func fetchLogs(runId: String) async throws -> [PanelLog] {
        let url = baseURL.appendingPathComponent("/api/runs/\(runId)/logs")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)

        let parsed = try decoder.decode(PanelLogsResponse.self, from: data)
        return parsed.logs
    }

    func fetchRuns(agent: String? = nil, limit: Int = 50) async throws -> [PanelRun] {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/runs"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let agent {
            queryItems.append(URLQueryItem(name: "agent", value: agent))
        }
        components.queryItems = queryItems

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)

        let parsed = try decoder.decode(PanelRunsResponse.self, from: data)
        return parsed.runs
    }

    // MARK: - Artifacts

    /// Fetch the merged artifacts feed from the panel for a given window of
    /// days (3 / 7 / 30 typical). 404-tolerant and offline-tolerant — if the
    /// route is missing or unreachable we return `[]` so local-first rendering
    /// keeps working.
    func fetchArtifacts(windowDays: Int) async -> [PanelArtifact] {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("/api/artifacts"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "window", value: String(windowDays)),
        ]
        guard let url = components?.url else { return [] }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return [] }
            if http.statusCode == 404 { return [] }
            guard (200...299).contains(http.statusCode) else { return [] }
            let parsed = try decoder.decode(PanelArtifactsResponse.self, from: data)
            return parsed.artifacts
        } catch {
            return []
        }
    }

    // MARK: - Decisions

    func fetchPendingDecisions() async throws -> [Decision] {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("/api/decisions"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "status", value: "pending")]

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)

        let parsed = try decoder.decode(DecisionsResponse.self, from: data)
        return parsed.decisions
    }

    func resolveDecision(id: String, body: DecisionResolveBody) async throws {
        let url = baseURL.appendingPathComponent("/api/decisions/\(id)/resolve")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(body)

        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
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
