import Foundation

@MainActor
extension StatusMonitor {
    enum AgentWriteOutcome: Equatable {
        case success
        case missingEnv([String])
        case failure(String)
    }

    @discardableResult
    func updateAgent(id: String, patch: [String: Any]) async -> AgentWriteOutcome {
        guard !isDemoMode else { return .failure("Demo Mode does not change your agents.") }
        do {
            let updated = try await client.updateAgent(id: id, patch: patch)
            replaceAgent(updated)
            return .success
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
            replaceAgent(updated)
            return .success
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
            poll()
            return .success(created)
        } catch {
            return .failure(error)
        }
    }

    @discardableResult
    func deleteAgent(id: String) async -> AgentWriteOutcome {
        guard !isDemoMode else { return .failure("Demo Mode does not change your agents.") }
        do {
            try await client.deleteAgent(id: id)
            agents.removeAll { $0.id == id }
            poll()
            return .success
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
            return .success(try await client.createConnectionProfile(request))
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
    }

    func connections() async -> ConnectionSnapshot {
        (try? await client.connections()) ?? .empty
    }

    func refreshConnections() async -> ConnectionSnapshot {
        (try? await client.refreshConnections()) ?? .empty
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
            return .started(runId: response.runId)
        } catch {
            if isRequestTimeout(error) {
                return await reconcileTriggeredRun(agentId: agentId, requestedAt: requestedAt)
            }
            return .failure(runTriggerFailure(for: error))
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
        guard let index = agents.firstIndex(where: { $0.id == updated.id }) else { return }
        agents[index] = updated
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
