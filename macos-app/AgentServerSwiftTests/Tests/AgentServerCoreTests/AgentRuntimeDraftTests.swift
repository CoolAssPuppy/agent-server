import XCTest
@testable import AgentServerCore

final class AgentRuntimeDraftTests: XCTestCase {
    func testInstalledKimiAndMoonshotKimiAreDistinctChoices() {
        let installed = AgentRuntimeDraft(
            executor: "kimi-code",
            model: nil,
            providerEndpoint: nil,
            providerKeyReference: nil
        )
        let moonshot = AgentRuntimeDraft(
            executor: "codex",
            model: KimiModelPreset.model,
            providerEndpoint: KimiModelPreset.endpoint,
            providerKeyReference: KimiModelPreset.keyReference
        )

        XCTAssertEqual(installed.choice, .kimiCode)
        XCTAssertEqual(moonshot.choice, .kimiK3)
        XCTAssertEqual(installed.resolvedExecutor, "kimi-code")
        XCTAssertNil(installed.resolvedModel)
        XCTAssertNil(installed.resolvedProviderEndpoint)
    }

    func testRuntimeChoicesUseClearDistinctNames() {
        XCTAssertEqual(
            AgentRuntimeChoice.allCases.map(\.displayName),
            ["Claude Code", "Codex", "Kimi Code", "Kimi K3 via Moonshot", "Custom model…"]
        )
    }

    func testSwitchingFromMoonshotToInstalledKimiClearsProviderFields() {
        var draft = AgentRuntimeDraft(
            executor: "codex",
            model: KimiModelPreset.model,
            providerEndpoint: KimiModelPreset.endpoint,
            providerKeyReference: KimiModelPreset.keyReference
        )

        draft.choice = .kimiCode

        XCTAssertEqual(draft.resolvedExecutor, "kimi-code")
        XCTAssertNil(draft.resolvedModel)
        XCTAssertNil(draft.resolvedProviderEndpoint)
        XCTAssertNil(draft.resolvedProviderKeyReference)
    }

    func testCustomProviderFieldsRemainEditableAndValidated() {
        var draft = AgentRuntimeDraft(
            executor: "codex",
            model: "private-model",
            providerEndpoint: "https://models.example.com/v1",
            providerKeyReference: "${PRIVATE_MODEL_KEY}"
        )

        XCTAssertEqual(draft.choice, .custom)
        XCTAssertEqual(draft.customKeyVariable, "PRIVATE_MODEL_KEY")
        XCTAssertTrue(draft.isValid)

        draft.customEndpoint = "   "
        XCTAssertFalse(draft.isValid)
    }

    func testBuildsAMachineLocalAssignmentRequest() {
        let draft = AgentRuntimeDraft(
            executor: "codex",
            model: "private-model",
            providerEndpoint: "https://models.example.com/v1",
            providerKeyReference: "${PRIVATE_MODEL_KEY}"
        )

        XCTAssertEqual(draft.assignmentRequest(expectedRevision: 4), AgentRuntimeAssignmentRequest(
            executor: "codex",
            model: "private-model",
            provider: AgentRuntimeProvider(
                baseURL: "https://models.example.com/v1",
                apiKey: "${PRIVATE_MODEL_KEY}"
            ),
            expectedRevision: 4
        ))
    }
}
