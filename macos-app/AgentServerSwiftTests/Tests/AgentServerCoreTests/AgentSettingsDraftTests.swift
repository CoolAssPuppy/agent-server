import XCTest

@testable import AgentServerCore

final class AgentSettingsDraftTests: XCTestCase {
    func testUnchangedSnapshotProducesNoPatchAndIsNotDirty() {
        let draft = AgentSettingsDraft(snapshot: snapshot())

        XCTAssertTrue(draft.patch.isEmpty)
        XCTAssertFalse(draft.isDirty)
        XCTAssertTrue(draft.isValid)
        XCTAssertEqual(draft.sourceAgentId, "agent-id")
    }

    func testSnapshotWhitespaceDoesNotBecomeAnImplicitEdit() {
        let draft = AgentSettingsDraft(snapshot: snapshot(
            name: " Agent ",
            description: " Description ",
            prompt: " Instructions ",
            schedule: " */5 * * * * "
        ))

        XCTAssertTrue(draft.patch.isEmpty)
    }

    func testTextChangesTrimValuesAndRepresentClearsExplicitly() {
        var draft = AgentSettingsDraft(snapshot: snapshot(description: "Old", schedule: "0 9 * * *"))
        draft.name = "  Renamed  "
        draft.descriptionText = "   "
        draft.schedule = ScheduleDraft(cron: nil)
        draft.promptText = " Updated instructions\n"

        XCTAssertEqual(draft.patch.name, "Renamed")
        XCTAssertEqual(draft.patch.description, .clear)
        XCTAssertEqual(draft.patch.schedule, .clear)
        XCTAssertEqual(draft.patch.prompt, " Updated instructions\n")
        XCTAssertTrue(draft.isDirty)
    }

    func testBlankPromptDoesNotEraseExistingInstructions() {
        var draft = AgentSettingsDraft(snapshot: snapshot())
        draft.promptText = " \n "

        XCTAssertNil(draft.patch.prompt)
        XCTAssertFalse(draft.isDirty)
    }

    func testMultilineWhitespaceIsEmptyForValidationAndOptionalText() {
        var draft = AgentSettingsDraft(snapshot: snapshot(description: "Old"))
        draft.name = "\n\t"
        draft.descriptionText = "\n\t"

        XCTAssertEqual(draft.validation, .invalid(.nameRequired))
        XCTAssertEqual(draft.patch.description, .clear)
    }

    func testCustomProviderRoundTripsWithoutChangesAndCanBeCleared() {
        let original = snapshot(
            executor: "codex",
            model: "private-model",
            provider: AgentSettingsProvider(endpoint: "https://models.example.com/v1", keyReference: "${PRIVATE_KEY}")
        )
        var draft = AgentSettingsDraft(snapshot: original)

        XCTAssertTrue(draft.patch.isEmpty)
        XCTAssertEqual(draft.runtime.choice, .custom)

        draft.runtime.choice = .claudeCode
        XCTAssertEqual(draft.patch.executor, .clear)
        XCTAssertEqual(draft.patch.model, .clear)
        XCTAssertEqual(draft.patch.provider, .clear)
    }

    func testCustomProviderKeyCanBeRemovedWithoutClearingTheProvider() {
        let provider = AgentSettingsProvider(
            endpoint: "https://models.example.com/v1",
            keyReference: "${PRIVATE_KEY}"
        )
        var draft = AgentSettingsDraft(snapshot: snapshot(
            executor: "codex",
            model: "private-model",
            provider: provider
        ))

        draft.runtime.customKeyVariable = ""

        XCTAssertEqual(
            draft.patch.provider,
            .set(AgentSettingsProvider(endpoint: provider.endpoint, keyReference: nil))
        )
        XCTAssertEqual(draft.patch.executor, .unchanged)
        XCTAssertEqual(draft.patch.model, .unchanged)
    }

    func testExistingModelWithoutProviderIsPreservedUntilRuntimeSelectionChanges() {
        let draft = AgentSettingsDraft(snapshot: snapshot(executor: "codex", model: "gpt-5"))

        XCTAssertEqual(draft.runtime.choice, .codex)
        XCTAssertTrue(draft.patch.isEmpty)
    }

    func testReturningEveryEditToItsSnapshotClearsDirtyState() {
        var draft = AgentSettingsDraft(snapshot: snapshot(capabilities: ["files": true]))
        draft.name = "Changed"
        draft.enabled = false
        draft.setCapability("files", enabled: false)
        XCTAssertTrue(draft.isDirty)

        draft.name = "Agent"
        draft.enabled = true
        draft.setCapability("files", enabled: true)
        XCTAssertFalse(draft.isDirty)
    }

    func testCapabilityDecisionsStayTypedAndSorted() {
        var draft = AgentSettingsDraft(snapshot: snapshot(capabilities: ["network": false, "files": true]))
        draft.setCapability("network", enabled: true)
        draft.setCapability("files", enabled: false)

        XCTAssertEqual(
            draft.patch.capabilities,
            [
                AgentCapabilityChange(id: "files", enabled: false),
                AgentCapabilityChange(id: "network", enabled: true),
            ]
        )
    }

    func testValidationCoversNameAndCustomProvider() {
        var draft = AgentSettingsDraft(snapshot: snapshot())
        draft.name = "   "
        XCTAssertEqual(draft.validation, .invalid(.nameRequired))

        draft.name = "Agent"
        draft.runtime.choice = .custom
        draft.runtime.customEndpoint = "   "
        XCTAssertEqual(draft.validation, .invalid(.providerEndpointRequired))
    }
}

final class ScheduleDraftTests: XCTestCase {
    func testKnownAndCustomSchedulesRoundTripWithoutRewriting() {
        for cron in [nil, "0 * * * *", "15 9 * * *", "30 8 * * 1-5", "45 7 * * 2", "*/5 * * * *"] {
            XCTAssertEqual(ScheduleDraft(cron: cron).cronExpression, cron)
        }
    }

    func testWhitespaceOnlyCustomScheduleClearsTheSchedule() {
        var draft = ScheduleDraft(cron: "*/5 * * * *")
        draft.customCron = "   "

        XCTAssertNil(draft.cronExpression)
    }
}

private func snapshot(
    name: String = "Agent",
    description: String? = "Description",
    prompt: String = "Instructions",
    schedule: String? = nil,
    executor: String? = nil,
    model: String? = nil,
    provider: AgentSettingsProvider? = nil,
    capabilities: [String: Bool] = [:]
) -> AgentSettingsSnapshot {
    AgentSettingsSnapshot(
        id: "agent-id",
        name: name,
        description: description,
        prompt: prompt,
        enabled: true,
        schedule: schedule,
        executor: executor,
        model: model,
        provider: provider,
        capabilities: capabilities
    )
}
