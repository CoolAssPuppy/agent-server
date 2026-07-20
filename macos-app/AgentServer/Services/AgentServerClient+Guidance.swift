import Foundation

extension AgentServerClient {
    func createGuidedProposal(_ body: GuidanceProposalRequest) async throws -> GuidanceProposalResponse {
        try await guidanceRequest(.createProposal, body: body)
    }

    func createSimilarProposal(
        agentId: String,
        body: GuidanceProposalRequest
    ) async throws -> GuidanceProposalResponse {
        try await guidanceRequest(.similarProposal(agentId), body: body)
    }

    func saveGuidedProposal(id: String) async throws -> GuidanceSaveResponse {
        do {
            return try await requestGuidedProposalSave(id: id)
        } catch where GuidanceSaveRetryPolicy.shouldRetry(error) {
            do {
                return try await requestGuidedProposalSave(id: id)
            } catch {
                if let confirmationError = GuidanceSaveRetryPolicy.confirmationError(after: error) {
                    throw confirmationError
                }
                throw error
            }
        }
    }

    private func requestGuidedProposalSave(id: String) async throws -> GuidanceSaveResponse {
        try await guidanceRequest(.saveProposal(id), body: GuidanceSaveRequest())
    }

    func diagnoseRun(id: String) async throws -> GuidanceDiagnosticPayload {
        try await guidanceRequest(.diagnosis(id))
    }

    func previewGuidancePatch(_ patch: GuidanceConfigurationPatch) async throws -> GuidancePatchPreview {
        try await guidanceRequest(.previewPatch, body: patch)
    }

    func applyGuidancePatch(_ patch: GuidanceConfigurationPatch) async throws -> GuidancePatchApplyResponse {
        try await guidanceRequest(.applyPatch, body: patch)
    }

    func retryGuidedRun(id: String) async throws -> GuidanceRetryResponse {
        try await guidanceRequest(.retry(id), body: GuidanceRetryRequest())
    }

    func triggerSafeTest(agentId: String) async throws -> TriggerResponse {
        try await guidanceRequest(.safeTest(agentId))
    }

    private func guidanceRequest<Response: Decodable>(
        _ route: GuidanceServerRoute
    ) async throws -> Response {
        try await routeRequest(
            path: route.path,
            method: route.method,
            usesGuidanceErrors: true,
            timeoutInterval: route.timeoutInterval
        )
    }

    private func guidanceRequest<Response: Decodable, Body: Encodable>(
        _ route: GuidanceServerRoute,
        body: Body
    ) async throws -> Response {
        try await routeRequest(
            path: route.path,
            method: route.method,
            bodyData: JSONEncoder().encode(body),
            usesGuidanceErrors: true,
            timeoutInterval: route.timeoutInterval
        )
    }
}
