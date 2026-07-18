import Foundation

extension AgentServerClient {
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

    private func securityRequest<Response: Decodable>(
        _ route: SecurityServerRoute
    ) async throws -> Response {
        try await routeRequest(path: route.path, method: route.method)
    }

    private func securityRequest<Response: Decodable, Body: Encodable>(
        _ route: SecurityServerRoute,
        body: Body
    ) async throws -> Response {
        try await routeRequest(
            path: route.path,
            method: route.method,
            bodyData: JSONEncoder().encode(body)
        )
    }
}
