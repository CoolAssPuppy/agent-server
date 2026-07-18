import Foundation

@MainActor
extension StatusMonitor {
    func scanAllSecurity() async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure> {
        do {
            let payload = try await client.scanSecurity()
            securityAnalyses = Dictionary(
                payload.analyses.map { ($0.agentId, $0) },
                uniquingKeysWith: { _, newest in newest }
            )
            let names = Dictionary(agents.map { ($0.id, $0.name) }, uniquingKeysWith: { _, newest in newest })
            return .success(payload.presentation(agentNames: names))
        } catch {
            return .failure(securityFailure(
                title: "Could not check your agents",
                error: error,
                recovery: "Make sure the local server is running, then try again."
            ))
        }
    }

    func analyzeSecurity(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        do {
            let analysis = try await client.securityAnalysis(agentId: agentId)
            securityAnalyses[agentId] = analysis
            return .success(securityPresentation(analysis))
        } catch {
            return .failure(securityFailure(
                title: "Could not check this agent",
                error: error,
                recovery: "Check that the agent still exists, then try again."
            ))
        }
    }

    func markSecurityReviewed(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let analysis = securityAnalyses[agentId] else {
            return .failure(securityFailure(
                title: "Run the security check first",
                error: ClientError.invalidResponse,
                recovery: "Check this agent again before marking it reviewed."
            ))
        }
        do {
            let response = try await client.markSecurityReviewed(
                agentId: agentId,
                contentHash: analysis.contentHash,
                acknowledgedFindingIds: analysis.findings.map(\.id)
            )
            guard response.reviewed else { throw ClientError.invalidResponse }
            return .success(securityPresentation(
                analysis,
                reviewedAt: response.reviewState?.reviewedDate ?? Date(),
                isStale: response.reviewState?.isStale ?? false
            ))
        } catch {
            return .failure(securityFailure(
                title: "Could not mark this agent reviewed",
                error: error,
                recovery: "The agent may have changed. Check it again, then retry."
            ))
        }
    }

    func acknowledgeSecurityFinding(
        agentId: String,
        findingId: String
    ) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let analysis = securityAnalyses[agentId],
              analysis.findings.contains(where: { $0.id == findingId }) else {
            return .failure(securityFailure(
                title: "This warning is no longer current",
                error: ClientError.invalidResponse,
                recovery: "Check this agent again before ignoring a warning."
            ))
        }
        do {
            securityAcknowledgements.acknowledge(
                agentId: agentId,
                contentHash: analysis.contentHash,
                findingId: findingId
            )
            let acknowledgedIds = securityAcknowledgements.findingIds(
                agentId: agentId,
                contentHash: analysis.contentHash
            )
            let response = try await client.markSecurityReviewed(
                agentId: agentId,
                contentHash: analysis.contentHash,
                acknowledgedFindingIds: acknowledgedIds.sorted()
            )
            guard response.reviewed else { throw ClientError.invalidResponse }
            return .success(securityPresentation(analysis, isStale: false))
        } catch {
            return .failure(securityFailure(
                title: "Could not ignore this warning",
                error: error,
                recovery: "The agent may have changed. Check it again, then retry."
            ))
        }
    }

    func applySecurityFix(
        agentId: String,
        findingId: String
    ) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let finding = securityAnalyses[agentId]?.findings.first(where: { $0.id == findingId }),
              let proposedPatch = finding.patch else {
            return .failure(securityFailure(
                title: "This change needs manual review",
                error: ClientError.invalidResponse,
                recovery: "Open agent settings and make the recommended change."
            ))
        }
        do {
            let preview = try await client.previewGuidancePatch(proposedPatch)
            guard preview.canApply else { throw ClientError.invalidResponse }
            let approvedPatch = preview.requiresConfirmation
                ? proposedPatch.confirming(previewContentHash: preview.resultContentHash)
                : proposedPatch
            _ = try await client.applyGuidancePatch(approvedPatch)
            return await analyzeSecurity(agentId: agentId)
        } catch {
            return .failure(securityFailure(
                title: "Could not apply the reviewed change",
                error: error,
                recovery: "The agent may have changed. Check it again, then review the fix."
            ))
        }
    }

    func redactedSecurityReport() -> String {
        let header = "Agent Server security report\nGenerated \(Date().formatted())\n"
        let entries = securityAnalyses.values.sorted { $0.agentId < $1.agentId }.map { analysis in
            let name = agents.first(where: { $0.id == analysis.agentId })?.name ?? analysis.agentId
            let findings = analysis.findings.map { "- [\($0.severity)] \($0.title)" }.joined(separator: "\n")
            return "\n\(name): \(analysis.risk.consumerLevel.title)\n\(findings.isEmpty ? "- No findings" : findings)"
        }
        return header + entries.joined(separator: "\n") + "\n\nCredential values and file contents are not included."
    }

    private func securityFailure(title: String, error: Error, recovery: String) -> ConsumerFlowFailure {
        ConsumerFlowFailure(
            title: title,
            message: "The local security check did not finish.",
            recovery: recovery,
            technicalDetails: error.localizedDescription,
            didSave: false,
            canRetry: true
        )
    }

    private func securityPresentation(
        _ analysis: SecurityAnalysisPayload,
        reviewedAt: Date? = nil,
        isStale: Bool? = nil
    ) -> SecurityScanPresentation {
        let acknowledged = securityAcknowledgements.findingIds(
            agentId: analysis.agentId,
            contentHash: analysis.contentHash
        )
        return SecurityScanPresentation(
            findings: analysis.findings
                .filter { !acknowledged.contains($0.id) }
                .map(\.presentation),
            reviewedAt: reviewedAt ?? analysis.reviewState?.reviewedDate,
            isStale: isStale ?? analysis.reviewState?.isStale ?? analysis.isStale
        )
    }
}
