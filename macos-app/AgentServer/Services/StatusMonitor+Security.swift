import Foundation

@MainActor
extension StatusMonitor {
    func startBackgroundSecurityScan() {
        guard !isDemoMode else { return }
        let scanAgents = securityScanAgents()
        let signature = securityScanTrigger
        guard securityScanTask == nil,
              signature != lastBackgroundSecuritySignature || securityScanState.phase == .idle else { return }
        lastBackgroundSecuritySignature = signature
        securityScanTask = makeSecurityScanTask(scanAgents)
    }

    var securityScanTrigger: [String] {
        agents.sorted { $0.id < $1.id }.map { agent in
            var hasher = Hasher()
            hasher.combine(agent.id)
            hasher.combine(agent.name)
            hasher.combine(agent.prompt)
            hasher.combine(agent.schedule)
            hasher.combine(agent.tools)
            hasher.combine(agent.disallowedTools)
            hasher.combine(agent.permissionMode)
            hasher.combine(agent.workingDirectory)
            hasher.combine(agent.model)
            hasher.combine(agent.executor)
            hasher.combine(agent.enabled)
            hasher.combine(agent.capabilities?.map { "\($0.id):\($0.enabled)" })
            return "\(agent.id):\(hasher.finalize())"
        }
    }

    func scanAllSecurity() async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure> {
        if isDemoMode {
            return .failure(ConsumerFlowFailure(
                title: "Security checks are paused in Demo Mode",
                message: "Disable Demo Mode to check your real agents.",
                recovery: "No agent or server data was changed.",
                technicalDetails: "Demo Mode uses local screenshot fixtures.",
                didSave: false,
                canRetry: false
            ))
        }
        if let securityScanTask { return await securityScanTask.value }
        let scanAgents = securityScanAgents()
        lastBackgroundSecuritySignature = securityScanTrigger
        let task = makeSecurityScanTask(scanAgents)
        securityScanTask = task
        return await task.value
    }

    func analyzeSecurity(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        if isDemoMode {
            return .failure(ConsumerFlowFailure(
                title: "Security checks are paused in Demo Mode",
                message: "Disable Demo Mode to check this agent.",
                recovery: "No agent or server data was changed.",
                technicalDetails: "Demo Mode uses local screenshot fixtures.",
                didSave: false,
                canRetry: false
            ))
        }
        do {
            let analysis = try await client.securityAnalysis(agentId: agentId)
            securityAnalyses[agentId] = analysis
            // The sidebar and the header pill read derived state, so a fresh
            // analysis has to reach them too, not only the page that asked.
            if !securityScanState.agents.isEmpty {
                securityDashboard = makeSecurityDashboard(for: securityScanState.agents)
            }
            return .success(securityPresentation(analysis))
        } catch {
            return .failure(securityFailure(
                title: "Could not check this agent",
                error: error,
                recovery: "Check that the agent still exists, then try again."
            ))
        }
    }

    func approveSecurityForAutomaticRuns(agentId: String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        guard let analysis = securityAnalyses[agentId] else {
            return .failure(securityFailure(
                title: "Run the security check first",
                error: ClientError.invalidResponse,
                recovery: "Check this agent again before approving automatic runs."
            ))
        }
        do {
            let response = try await client.markSecurityReviewed(
                agentId: agentId,
                contentHash: analysis.contentHash,
                acknowledgedFindingIds: analysis.findings.map(\.id)
            )
            guard response.reviewed else { throw ClientError.invalidResponse }
            // Re-read what the server now says. The cached analysis still
            // carries the pre-review verdict, and the sidebar and dashboard
            // read the cache -- without this, an agent stayed marked as
            // waiting for the review its person had just finished.
            let fresh = await refreshAnalysisAfterReview(agentId: agentId) ?? analysis
            return .success(securityPresentation(
                fresh,
                reviewedAt: response.reviewState?.reviewedDate ?? Date(),
                isStale: response.reviewState?.isStale ?? false
            ))
        } catch {
            return .failure(securityFailure(
                title: "Could not approve automatic runs",
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
            let fresh = await refreshAnalysisAfterReview(agentId: agentId) ?? analysis
            return .success(securityPresentation(fresh, isStale: false))
        } catch {
            return .failure(securityFailure(
                title: "Could not ignore this warning",
                error: error,
                recovery: "The agent may have changed. Check it again, then retry."
            ))
        }
    }

    func reviewSecurityFix(
        agentId: String,
        findingId: String
    ) async -> Result<GuidancePatchPreview, ConsumerFlowFailure> {
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
            securityPatches["\(agentId):\(findingId)"] = (proposedPatch, preview)
            return .success(preview)
        } catch {
            return .failure(securityFailure(
                title: "Could not prepare this change",
                error: error,
                recovery: "The agent may have changed. Check it again, then review this fix."
            ))
        }
    }

    func applySecurityFix(
        agentId: String,
        findingId: String
    ) async -> Result<SecurityScanPresentation, ConsumerFlowFailure> {
        let key = "\(agentId):\(findingId)"
        guard let context = securityPatches.removeValue(forKey: key) else {
            return .failure(securityFailure(
                title: "Review the change first",
                error: ClientError.invalidResponse,
                recovery: "Open the fix preview before applying it."
            ))
        }
        do {
            let approvedPatch = context.preview.requiresConfirmation
                ? context.patch.confirming(previewContentHash: context.preview.resultContentHash)
                : context.patch
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

    private func securityScanAgents() -> [SecurityScanAgent] {
        agents
            .map { SecurityScanAgent(id: $0.id, name: $0.name) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func makeSecurityScanTask(
        _ scanAgents: [SecurityScanAgent]
    ) -> Task<Result<SecurityDashboardPresentation, ConsumerFlowFailure>, Never> {
        Task { [weak self] in
            guard let self else {
                return .failure(ConsumerFlowFailure(
                    title: "Could not check your agents",
                    message: "The security check stopped because the window closed.",
                    recovery: "Open Security check to try again.",
                    technicalDetails: "The security monitor is no longer available.",
                    didSave: false,
                    canRetry: true
                ))
            }
            let result = await self.performSequentialSecurityScan(scanAgents)
            self.securityScanTask = nil
            return result
        }
    }

    /// Re-fetches one agent's analysis after its review changed on the
    /// server, and rebuilds every published surface that reads the cache.
    private func refreshAnalysisAfterReview(agentId: String) async -> SecurityAnalysisPayload? {
        guard let fresh = try? await client.securityAnalysis(agentId: agentId) else { return nil }
        securityAnalyses[agentId] = fresh
        if !securityScanState.agents.isEmpty {
            securityDashboard = makeSecurityDashboard(for: securityScanState.agents)
        }
        return fresh
    }

    private func performSequentialSecurityScan(
        _ scanAgents: [SecurityScanAgent]
    ) async -> Result<SecurityDashboardPresentation, ConsumerFlowFailure> {
        securityScanState = .scanning(agents: scanAgents)
        securityScanFailure = nil
        var firstFailure: ConsumerFlowFailure?

        for agent in scanAgents {
            guard !Task.isCancelled else { break }
            do {
                let analysis = try await client.securityAnalysis(agentId: agent.id)
                securityAnalyses[agent.id] = analysis
                securityScanState = securityScanState.completingCurrentAgent(
                    risk: analysis.risk.consumerLevel
                )
            } catch {
                let failure = securityFailure(
                    title: "Could not check \(agent.name)",
                    error: error,
                    recovery: "Make sure the local server is running, then try again."
                )
                firstFailure = firstFailure ?? failure
                securityScanState = securityScanState.recordingCurrentFailure(message: failure.message)
            }
        }

        let dashboard = makeSecurityDashboard(for: scanAgents)
        securityDashboard = dashboard
        securityAnalyses = securityAnalyses.filter { analysis in
            scanAgents.contains { $0.id == analysis.key }
        }
        securityScanState = securityScanState.reportingAttention(count: dashboard.notificationAttentionCount)
        securityScanFailure = firstFailure
        if let firstFailure { return .failure(firstFailure) }
        return .success(dashboard)
    }

    private func makeSecurityDashboard(
        for scanAgents: [SecurityScanAgent]
    ) -> SecurityDashboardPresentation {
        let checkedAgents = scanAgents.compactMap { agent -> SecurityAgentPresentation? in
            guard let analysis = securityAnalyses[agent.id] else { return nil }
            return SecurityAgentPresentation(
                id: agent.id,
                name: agent.name,
                risk: analysis.risk.consumerLevel,
                findingCount: analysis.findings.count,
                isStale: analysis.reviewState?.isStale ?? analysis.isStale,
                approval: analysis.approvalState
            )
        }
        return SecurityDashboardPresentation(
            scanAgents: securityScanState.agents,
            checkedAgents: checkedAgents
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
