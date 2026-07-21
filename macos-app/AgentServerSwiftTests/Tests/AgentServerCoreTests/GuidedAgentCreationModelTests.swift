import XCTest
@testable import AgentServerCore

final class GuidedAgentCreationModelTests: XCTestCase {
    func testAnswerValidationAndBackRestoreQuestionDrafts() {
        let question = CreationQuestion(
            id: "schedule",
            prompt: "When should it run?",
            kind: .schedule,
            isRequired: true
        )
        var model = GuidedAgentCreationModel(request: "Send a summary")
        model.flow.receiveQuestions([question])

        XCTAssertEqual(model.currentAnswer, .string("manual"))
        model.scheduleCron = "0 9 * * 1"
        let preparation = model.answerCurrentQuestion()

        XCTAssertEqual(preparation?.answers[question.id], .string("0 9 * * 1"))
        model.flow.receiveProposal(ConsumerFlowDemoFixtures.proposal)
        model.goBack()
        XCTAssertEqual(model.scheduleCron, "0 9 * * 1")
    }

    func testPreparationIgnoresResultsFromSupersededGenerations() {
        var model = GuidedAgentCreationModel(request: "First request")
        let first = tryUnwrap(model.startPreparation())
        model.returnToRequest()
        model.request = "Second request"
        let second = tryUnwrap(model.startPreparation())

        XCTAssertFalse(model.receivePreparation(.success(.proposal(ConsumerFlowDemoFixtures.proposal)), generation: first.generation))
        XCTAssertEqual(model.flow.phase, .preparingProposal)
        XCTAssertTrue(model.receivePreparation(.success(.proposal(ConsumerFlowDemoFixtures.proposal)), generation: second.generation))
        XCTAssertEqual(model.flow.phase, .proposal)
    }

    func testHighRiskSaveRequiresConfirmationAndSaveResultsAreGenerationSafe() {
        var model = GuidedAgentCreationModel(request: "Publish a summary")
        model.flow.receiveProposal(proposal(risk: .high))

        XCTAssertEqual(model.requestSave(runSafeTest: true), .confirmationRequired(runSafeTest: true))
        let first = tryUnwrap(model.confirmHighRiskSave())
        model.flow.receiveProposal(proposal(risk: .high))
        XCTAssertEqual(model.requestSave(runSafeTest: false), .confirmationRequired(runSafeTest: false))
        let second = tryUnwrap(model.confirmHighRiskSave())

        let saved = SavedAgentPresentation(agentId: "summary", safeTestRunId: nil)
        XCTAssertFalse(model.receiveSave(.success(saved), generation: first.generation))
        XCTAssertTrue(model.receiveSave(.success(saved), generation: second.generation))
        XCTAssertEqual(model.flow.phase, .complete)
    }

    func testRetryCreatesANewPreparationWithoutDroppingAnswers() {
        let question = CreationQuestion(id: "tone", prompt: "Tone?", kind: .text, isRequired: true)
        var model = GuidedAgentCreationModel(request: "Write a summary")
        model.flow.receiveQuestions([question])
        model.answer = "Concise"
        let first = tryUnwrap(model.answerCurrentQuestion())
        let failure = ConsumerFlowFailure(
            title: "Try again",
            message: "Preparation failed.",
            recovery: "Retry.",
            technicalDetails: "timeout",
            didSave: false,
            canRetry: true
        )
        XCTAssertTrue(model.receivePreparation(.failure(failure), generation: first.generation))

        let retry = tryUnwrap(model.retry())

        XCTAssertEqual(retry.answers[question.id], .string("Concise"))
        XCTAssertNotEqual(retry.generation, first.generation)
    }

    func testStoppingSafeTestInvalidatesLateObservationResults() {
        var model = GuidedAgentCreationModel(request: "Write a summary")
        model.flow.receiveProposal(ConsumerFlowDemoFixtures.proposal)
        guard case .save(let save) = model.requestSave(runSafeTest: true) else {
            return XCTFail("Expected immediate save")
        }
        let saved = SavedAgentPresentation(agentId: "summary", safeTestRunId: "run-1")
        XCTAssertTrue(model.receiveSave(.success(saved), generation: save.generation))
        let observation = tryUnwrap(model.safeTestObservation)

        XCTAssertEqual(model.stopSafeTest(), "run-1")
        XCTAssertEqual(model.flow.safeTestState, .stopped)
        XCTAssertFalse(model.receiveSafeTest(.completed, generation: observation.generation))
        let failure = ConsumerFlowFailure(
            title: "Polling failed",
            message: "Could not check the run.",
            recovery: "Try again.",
            technicalDetails: "network",
            didSave: true,
            canRetry: false
        )
        XCTAssertFalse(model.receiveSafeTest(.failure(failure), generation: observation.generation))
        XCTAssertEqual(model.flow.phase, .complete)
    }

    private func tryUnwrap<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) -> T {
        guard let value else {
            XCTFail("Expected a value", file: file, line: line)
            fatalError("Test cannot continue")
        }
        return value
    }

    private func proposal(risk: ConsumerRiskLevel) -> AgentProposalPresentation {
        let fixture = ConsumerFlowDemoFixtures.proposal
        return AgentProposalPresentation(
            reviewId: fixture.reviewId,
            name: fixture.name,
            explanation: fixture.explanation,
            schedule: fixture.schedule,
            permissions: fixture.permissions,
            fileAccess: fixture.fileAccess,
            calendarAccess: fixture.calendarAccess,
            reminderAccess: fixture.reminderAccess,
            contactAccess: fixture.contactAccess,
            connections: fixture.connections,
            instructions: fixture.instructions,
            risk: risk,
            riskReason: fixture.riskReason
        )
    }
}
