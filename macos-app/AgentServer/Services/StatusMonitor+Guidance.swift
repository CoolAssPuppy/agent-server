import Foundation

@MainActor
extension StatusMonitor {
    func prepareGuidedAgent(
        request: String,
        answers: [String: CreationAnswerValue]
    ) async -> Result<CreationPreparation, ConsumerFlowFailure> {
        do {
            let proposalRequest = try await makeProposalRequest(request: request, answers: answers)
            let response = try await client.createGuidedProposal(proposalRequest)
            return .success(Self.creationPreparation(from: response))
        } catch {
            return .failure(guidanceFailure(
                title: "Could not prepare your agent",
                message: "The local creation service did not finish the proposal.",
                recovery: "Make sure Agent Server and Codex are available, then try again.",
                error: error
            ))
        }
    }

    func prepareSimilarAgent(
        sourceAgentId: String,
        request: String,
        answers: [String: CreationAnswerValue]
    ) async -> Result<CreationPreparation, ConsumerFlowFailure> {
        do {
            let proposalRequest = try await makeProposalRequest(request: request, answers: answers)
            let response = try await client.createSimilarProposal(
                agentId: sourceAgentId,
                body: proposalRequest
            )
            return .success(Self.creationPreparation(from: response))
        } catch {
            return .failure(guidanceFailure(
                title: "Could not prepare a similar agent",
                message: "The local creation service did not finish the proposal.",
                recovery: "Make sure the source agent still exists, then try again.",
                error: error
            ))
        }
    }

    func saveGuidedAgent(
        proposal: AgentProposalPresentation,
        runSafeTest: Bool
    ) async -> Result<SavedAgentPresentation, ConsumerFlowFailure> {
        guard let reviewId = proposal.reviewId else {
            return .failure(guidanceFailure(
                title: "Review this proposal again",
                message: "The proposal no longer has a valid review record.",
                recovery: "Go back and prepare the proposal again before saving.",
                error: ClientError.invalidResponse
            ))
        }
        do {
            let response = try await client.saveGuidedProposal(id: reviewId)
            guard response.saved else { throw ClientError.invalidResponse }
            poll()
            guard runSafeTest else {
                return .success(SavedAgentPresentation(agentId: response.agent.id, safeTestRunId: nil))
            }
            return await runSafeTestForSavedAgent(response.agent.id)
        } catch {
            return .failure(ConsumerFlowFailure(
                title: "Could not save your agent",
                message: "The reviewed agent was not fully saved.",
                recovery: "Check the server and any required connections, then try again.",
                technicalDetails: error.localizedDescription,
                didSave: false,
                canRetry: true
            ))
        }
    }

    func diagnoseRun(id: String) async -> Result<DiagnosticPresentation, ConsumerFlowFailure> {
        do {
            let diagnosis = try await client.diagnoseRun(id: id)
            guard let patch = diagnosis.validatedPatch else {
                debuggerPatches[id] = nil
                return .success(diagnosis.presentation)
            }
            let preview = try await client.previewGuidancePatch(patch)
            debuggerPatches[id] = preview.canApply ? (patch, preview) : nil
            return .success(diagnosis.presentation(with: preview))
        } catch {
            return .failure(guidanceFailure(
                title: "Could not explain this run",
                message: "The local debugger could not finish its checks.",
                recovery: "Make sure the run still exists and the server is available, then try again.",
                error: error
            ))
        }
    }

    func applyDebuggerFix(runId: String) async -> Result<Void, ConsumerFlowFailure> {
        guard let context = debuggerPatches[runId], context.preview.canApply else {
            return .failure(guidanceFailure(
                title: "This fix cannot be applied",
                message: "The server did not provide a current validated change.",
                recovery: "Run the diagnosis again before changing the agent.",
                error: ClientError.invalidResponse
            ))
        }
        do {
            let patch = context.preview.requiresConfirmation
                ? context.patch.confirming(previewContentHash: context.preview.resultContentHash)
                : context.patch
            _ = try await client.applyGuidancePatch(patch)
            poll()
            return .success(())
        } catch {
            return .failure(guidanceFailure(
                title: "Could not apply the reviewed fix",
                message: "No unreviewed change was applied.",
                recovery: "The agent may have changed. Diagnose the run again, then retry.",
                error: error
            ))
        }
    }

    func retryRun(id: String) async -> Result<String, ConsumerFlowFailure> {
        do {
            let response = try await client.retryGuidedRun(id: id)
            poll()
            return .success(response.runId)
        } catch {
            return .failure(guidanceFailure(
                title: "Could not start the retry",
                message: "The original failed run is still preserved.",
                recovery: "Check the server and required connections, then try again.",
                error: error
            ))
        }
    }

    private func runSafeTestForSavedAgent(
        _ agentId: String
    ) async -> Result<SavedAgentPresentation, ConsumerFlowFailure> {
        do {
            let runId = try await client.triggerSafeTest(agentId: agentId).runId
            return .success(SavedAgentPresentation(agentId: agentId, safeTestRunId: runId))
        } catch {
            return .failure(ConsumerFlowFailure(
                title: "Agent saved, but the test did not start",
                message: "Your reviewed agent is saved locally.",
                recovery: "Open the agent to check its connections, then run a safe test again.",
                technicalDetails: error.localizedDescription,
                didSave: true,
                canRetry: true
            ))
        }
    }

    private static func guidanceValue(_ value: CreationAnswerValue) -> GuidanceProposalAnswerValue {
        switch value {
        case .string(let answer):
            switch answer.lowercased() {
            case "yes": return .boolean(true)
            case "no": return .boolean(false)
            default: return .string(answer)
            }
        case .fileGrants(let grants): return .fileGrants(grants)
        }
    }

    private func makeProposalRequest(
        request: String,
        answers: [String: CreationAnswerValue]
    ) async throws -> GuidanceProposalRequest {
        await EventKitPermissionManager().requestAccessNeeded(for: request)
        let connectedServices = try await client.services().connectedServices
        let answerPayloads = answers.sorted(by: { $0.key < $1.key }).map {
            GuidanceProposalAnswer(questionId: $0.key, value: Self.guidanceValue($0.value))
        }
        return GuidanceProposalRequest(
            request: request,
            timezone: TimeZone.current.identifier,
            connectedServices: connectedServices,
            availableCalendars: EventKitPermissionManager.availableCalendars(),
            availableReminderLists: EventKitPermissionManager.availableReminderLists(),
            answers: answerPayloads
        )
    }

    private static func creationPreparation(from response: GuidanceProposalResponse) -> CreationPreparation {
        switch response {
        case .proposal(let review): return .proposal(review.presentation)
        case .needsInformation(let questions, _): return .questions(questions)
        }
    }

    private func guidanceFailure(
        title: String,
        message: String,
        recovery: String,
        error: Error
    ) -> ConsumerFlowFailure {
        ConsumerFlowFailure(
            title: title,
            message: message,
            recovery: recovery,
            technicalDetails: error.localizedDescription,
            didSave: false,
            canRetry: true
        )
    }
}
