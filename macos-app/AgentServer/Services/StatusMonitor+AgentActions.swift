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

    func connections() async -> ConnectionSnapshot {
        (try? await client.connections()) ?? .empty
    }

    func refreshConnections() async -> ConnectionSnapshot {
        (try? await client.refreshConnections()) ?? .empty
    }

    func saveConnectionKeys(_ values: [String: String]) throws {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-server/.env.local")
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
        Task {
            do {
                try await client.cancelRun(id: id)
                poll()
            } catch {
                // The next poll will show the current server state.
            }
        }
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
