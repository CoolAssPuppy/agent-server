import Foundation

@MainActor
extension StatusMonitor {
    enum AgentWriteOutcome {
        case success(Agent)
        case deleted
        case missingEnv([String])
        case failure(String)
    }

    @discardableResult
    func updateAgent(id: String, patch: [String: Any]) async -> AgentWriteOutcome {
        guard !isDemoMode else { return .failure("Demo Mode does not change your agents.") }
        do {
            let updated = try await client.updateAgent(id: id, patch: patch)
            agentSnapshotRevision.recordMutation()
            replaceAgent(updated)
            // The patch keys say which fields an edit touched — schedule,
            // model, enabled — without carrying a single one of their values.
            Telemetry.capture(.agentUpdated, properties: [
                "agent_id": id,
                "fields": patch.keys.sorted(),
            ])
            return .success(updated)
        } catch {
            return writeOutcome(for: error)
        }
    }

    @discardableResult
    func setCapability(agentId: String, capabilityId: String, enabled: Bool) async -> AgentWriteOutcome {
        guard !isDemoMode else { return .failure("Demo Mode does not change your agents.") }
        do {
            let updated = try await client.setCapability(
                agentId: agentId,
                capabilityId: capabilityId,
                enabled: enabled
            )
            agentSnapshotRevision.recordMutation()
            replaceAgent(updated)
            Telemetry.capture(.agentCapabilityToggled, properties: [
                "agent_id": agentId,
                "capability_id": capabilityId,
                "enabled": enabled,
            ])
            return .success(updated)
        } catch {
            return writeOutcome(for: error)
        }
    }

    func createAgent(
        name: String,
        description: String?,
        prompt: String,
        schedule: String?,
        capabilities: [(id: String, enabled: Bool)]
    ) async -> Result<Agent, Error> {
        guard !isDemoMode else { return .failure(DemoModeWriteError()) }
        do {
            let created = try await client.createAgent(
                name: name,
                description: description,
                prompt: prompt,
                schedule: schedule,
                capabilities: capabilities
            )
            agentSnapshotRevision.recordMutation()
            replaceAgent(created)
            poll()
            Telemetry.capture(.agentCreated, properties: [
                "agent_id": created.id,
                "scheduled": schedule?.isEmpty == false,
                "capability_count": capabilities.filter(\.enabled).count,
            ])
            return .success(created)
        } catch {
            Telemetry.capture(.agentCreationFailed, properties: [
                "reason": Telemetry.reason(for: error),
            ])
            return .failure(error)
        }
    }

    @discardableResult
    func deleteAgent(id: String) async -> AgentWriteOutcome {
        guard !isDemoMode else { return .failure("Demo Mode does not change your agents.") }
        do {
            try await client.deleteAgent(id: id)
            agentSnapshotRevision.recordMutation()
            liveAgents.removeAll { $0.id == id }
            agents.removeAll { $0.id == id }
            poll()
            Telemetry.capture(.agentDeleted, properties: ["agent_id": id])
            return .deleted
        } catch {
            return writeOutcome(for: error)
        }
    }

    func capabilityCatalog() async -> [CapabilityCatalogEntry] {
        (try? await client.capabilityCatalog()) ?? []
    }

    func serviceConnections() async -> [GuidanceServiceConnection] {
        (try? await client.services().connections) ?? []
    }

    func connectionProfiles() async -> [ConnectionProfile] {
        (try? await client.connectionProfiles()) ?? []
    }

    func createConnectionProfile(
        _ request: ConnectionProfileCreateRequest
    ) async -> Result<ConnectionProfile, Error> {
        guard !isDemoMode else { return .failure(DemoModeWriteError()) }
        do {
            let profile = try await client.createConnectionProfile(request)
            // The adapter slug, never the label: a user names a profile
            // "Acme production Slack" and that names a customer.
            Telemetry.capture(.connectionCreated, properties: ["adapter_id": request.adapter.id])
            return .success(profile)
        } catch {
            return .failure(error)
        }
    }

    func renameConnectionProfile(id: String, label: String) async throws -> ConnectionProfile {
        guard !isDemoMode else { throw DemoModeWriteError() }
        return try await client.renameConnectionProfile(id: id, label: label)
    }

    func duplicateConnectionProfile(id: String, label: String) async throws -> ConnectionProfile {
        guard !isDemoMode else { throw DemoModeWriteError() }
        return try await client.duplicateConnectionProfile(id: id, label: label)
    }

    func checkConnectionProfile(id: String) async throws -> ConnectionReadinessResponse {
        try await client.checkConnectionProfile(id: id)
    }

    func removeConnectionProfile(id: String) async throws {
        guard !isDemoMode else { throw DemoModeWriteError() }
        try await client.removeConnectionProfile(id: id)
        Telemetry.capture(.connectionRemoved)
    }

    func connections() async -> ConnectionSnapshot {
        (try? await client.connections()) ?? .empty
    }

    func refreshConnections() async -> ConnectionSnapshot {
        (try? await client.refreshConnections()) ?? .empty
    }

    func slackPairingStatus() async -> SlackPairingStatus {
        (try? await client.slackPairingStatus()) ?? .error
    }

    func pairSlack(channelID: String) async throws -> SlackPairingStatus {
        guard !isDemoMode else { throw DemoModeWriteError() }
        return try await client.pairSlack(channelID: channelID)
    }

    func testSlack() async throws {
        guard !isDemoMode else { throw DemoModeWriteError() }
        _ = try await client.testSlack()
    }

    func saveConnectionKeys(_ values: [String: String]) throws {
        guard !isDemoMode else { throw DemoModeWriteError() }
        let url = AgentServerWorkspaceStore.current().environmentFile
        var pairs = try EnvFileStore.load(from: url)
        for (key, value) in values {
            if let index = pairs.firstIndex(where: { $0.key == key }) {
                pairs[index] = EnvPair(key: key, value: value)
            } else {
                pairs.append(EnvPair(key: key, value: value))
            }
        }
        try EnvFileStore.save(pairs, to: url)
        // Count only. The keys name third-party services and the values are
        // credentials, so neither belongs in an event.
        Telemetry.capture(.connectionKeysSaved, properties: ["key_count": values.count])
        if activeRuns.isEmpty { requestServerRestart() }
    }

    func cleanupStaleRuns() {
        guard !isDemoMode else { return }
        Task {
            do {
                let result = try await client.cleanupStaleRuns()
                staleRunCount = 0
                if result.cleaned > 0 {
                    print("[StatusMonitor] Cleaned up \(result.cleaned) stale run(s)")
                }
                poll()
            } catch {
                print("[StatusMonitor] Cleanup failed: \(error)")
            }
        }
    }

    func cancelRun(id: String) {
        guard !isDemoMode else { return }
        Task {
            do {
                try await client.cancelRun(id: id)
                Telemetry.capture(.runCancelled, properties: ["run_id": id])
                poll()
            } catch {
                // The next poll will show the current server state.
            }
        }
    }

    func triggerRun(agentId: String) async -> AgentRunTriggerState {
        guard !isDemoMode else { return .failure(.generic) }
        let requestedAt = Date()
        do {
            let response = try await client.triggerRun(agentId: agentId)
            poll()
            Telemetry.capture(.runTriggered, properties: ["agent_id": agentId])
            return .started(runId: response.runId)
        } catch {
            if isRequestTimeout(error) {
                return await reconcileTriggeredRun(agentId: agentId, requestedAt: requestedAt)
            }
            let failure = runTriggerFailure(for: error)
            Telemetry.capture(.runTriggerFailed, properties: [
                "agent_id": agentId,
                "reason": failure.analyticsReason,
            ])
            return .failure(failure)
        }
    }

    func reconcileTriggeredRun(agentId: String, requestedAt: Date) async -> AgentRunTriggerState {
        do {
            let runs = try await client.runs()
            let candidates = runs.map {
                AgentRunCandidate(runId: $0.runId, agentId: $0.agentId, startedAt: $0.startedAt)
            }
            if let runId = AgentRunReconciliation.matchedRunId(
                agentId: agentId,
                requestedAt: requestedAt,
                candidates: candidates
            ) {
                poll()
                return .started(runId: runId)
            }
            poll()
            return .failure(.takingLonger)
        } catch {
            return .failure(runTriggerFailure(for: error))
        }
    }

    private func runTriggerFailure(for error: Error) -> AgentRunTriggerFailure {
        if case let ClientError.runTriggerFailed(message, code, missingEnv) = error {
            return .classify(
                serverCode: code,
                serverMessage: message,
                hasMissingConnection: !missingEnv.isEmpty
            )
        }

        let isTimeout = isRequestTimeout(error)
        let nsError = error as NSError
        return .classify(
            serverCode: nil,
            isTransportFailure: !isTimeout && (
                error is URLError || nsError.domain == NSURLErrorDomain
            ),
            isRequestTimeout: isTimeout
        )
    }

    private func isRequestTimeout(_ error: Error) -> Bool {
        if let urlError = error as? URLError { return urlError.code == .timedOut }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut
    }

    private func replaceAgent(_ updated: Agent) {
        replaceAgent(updated, in: &liveAgents)
        if !isDemoMode {
            replaceAgent(updated, in: &agents)
        }
    }

    private func replaceAgent(_ updated: Agent, in collection: inout [Agent]) {
        if let index = collection.firstIndex(where: { $0.id == updated.id }) {
            collection[index] = updated
        } else {
            collection.append(updated)
        }
    }

    private func writeOutcome(for error: Error) -> AgentWriteOutcome {
        if let clientError = error as? ClientError, !clientError.missingEnvVars.isEmpty {
            return .missingEnv(clientError.missingEnvVars)
        }
        return .failure(error.localizedDescription)
    }
}

private struct DemoModeWriteError: LocalizedError {
    var errorDescription: String? { "Demo Mode does not change your agents." }
}
