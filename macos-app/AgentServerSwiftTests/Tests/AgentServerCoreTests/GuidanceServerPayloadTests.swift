import XCTest
@testable import AgentServerCore

final class GuidanceServerPayloadTests: XCTestCase {
    func testCalendarQuestionKeepsNativeChoices() throws {
        let data = Data(#"{"status":"needs_information","questions":[{"id":"calendar-id","question":"Which calendar?","control":"single_choice","required":true,"choices":[{"label":"Work (iCloud)","value":"work-id"}]}],"explanation":"Choose one calendar."}"#.utf8)

        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: data)

        guard case .needsInformation(let questions, _) = response else {
            return XCTFail("Expected a question")
        }
        XCTAssertEqual(questions.first?.kind, .choice(["Work (iCloud)"]))
        XCTAssertEqual(questions.first?.choiceValues, ["work-id"])
    }

    func testServiceQuestionKeepsConnectionSetupSemantics() throws {
        let data = Data(#"{"status":"needs_information","questions":[{"id":"connection-notion","question":"Set up Notion.","control":"service","service_name":"Notion","required":true,"choices":[]}],"explanation":"Connect first."}"#.utf8)

        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: data)

        guard case .needsInformation(let questions, _) = response else {
            return XCTFail("Expected a question")
        }
        XCTAssertEqual(questions.first?.kind, .service(name: "Notion", choices: []))
        XCTAssertTrue(questions.first?.requiresConnectionSetup == true)
    }

    func testUnavailableCapabilityCannotBeAnsweredOrContinued() throws {
        let data = Data(#"{"status":"needs_information","questions":[{"id":"apple-music-unavailable","question":"Apple Music is not available in this build.","control":"unavailable","required":true}],"explanation":"No access was added."}"#.utf8)

        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: data)

        guard case .needsInformation(let questions, _) = response else {
            return XCTFail("Expected an unavailable capability")
        }
        XCTAssertEqual(questions.first?.kind, .unavailable)
    }

    func testFileAccessQuestionAndAnswerKeepEachReviewedGrant() throws {
        let data = Data(#"{"status":"needs_information","questions":[{"id":"file-access","question":"Which files or folders?","control":"file_access","required":true}],"explanation":"Choose access."}"#.utf8)
        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: data)
        guard case .needsInformation(let questions, _) = response else { return XCTFail("Expected a question") }
        XCTAssertEqual(questions.first?.kind, .fileAccess)

        let request = GuidanceProposalRequest(
            request: "Review my manuscript",
            timezone: "Europe/Lisbon",
            connectedServices: [],
            availableCalendars: [],
            answers: [GuidanceProposalAnswer(questionId: "file-access", value: .fileGrants([
                CreationFileGrant(path: "/Users/test/Book/manuscript.docx", kind: .file, access: .readOnly),
                CreationFileGrant(path: "/Users/test/Book/Notes", kind: .folder, access: .readWrite),
            ]))]
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        let answers = try XCTUnwrap(object["answers"] as? [[String: Any]])
        let grants = try XCTUnwrap(answers.first?["value"] as? [[String: String]])
        XCTAssertEqual(grants, [
            ["path": "/Users/test/Book/manuscript.docx", "kind": "file", "access": "read_only"],
            ["path": "/Users/test/Book/Notes", "kind": "folder", "access": "read_write"],
        ])
    }

    func testGenericServiceQuestionDoesNotBecomeNotionSpecific() throws {
        let data = Data(#"{"status":"needs_information","questions":[{"id":"destination","question":"Where should the result be sent?","control":"service","required":true,"choices":[{"label":"Slack","value":"slack"}]}],"explanation":"Choose a destination."}"#.utf8)

        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: data)

        guard case .needsInformation(let questions, _) = response else {
            return XCTFail("Expected a question")
        }
        XCTAssertEqual(questions.first?.kind, .service(name: nil, choices: ["Slack"]))
        XCTAssertFalse(questions.first?.requiresConnectionSetup == true)
    }

    func testProposalResponseRetainsReviewIdAndMapsConsumerState() throws {
        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: Data(Self.proposalJSON.utf8))
        guard case .proposal(let review) = response else { return XCTFail("Expected proposal") }

        XCTAssertEqual(review.presentation.reviewId, "proposal-1")
        XCTAssertEqual(review.presentation.schedule, "Every Friday at 5:00 p.m.")
        XCTAssertEqual(review.presentation.connections.first?.state, .needsSetup)
        XCTAssertTrue(review.presentation.connections.first?.isRequired == true)
        XCTAssertEqual(review.presentation.connections.first?.reason, "Sends the summary")
        XCTAssertEqual(review.presentation.fileAccess.first?.canEdit, false)
        XCTAssertEqual(review.presentation.calendarAccess.first?.name, "Work")
        XCTAssertEqual(review.presentation.calendarAccess.first?.account, "iCloud")
        XCTAssertEqual(review.presentation.calendarAccess.first?.canEdit, false)
        XCTAssertEqual(review.presentation.reminderAccess.first?.name, "Book ideas")
        XCTAssertEqual(review.presentation.reminderAccess.first?.account, "Personal")
        XCTAssertEqual(review.presentation.reminderAccess.first?.actions, ["View", "Add", "Mark complete"])
        XCTAssertEqual(review.presentation.contactAccess.first?.name, "Family")
        XCTAssertEqual(review.presentation.contactAccess.first?.account, "iCloud")
        XCTAssertEqual(review.presentation.contactAccess.first?.details, ["Names", "Birthdays"])
        XCTAssertTrue(review.presentation.permissions.contains("Use the internet"))
    }

    func testFallbackQuestionsMapToNativeControls() throws {
        let response = try JSONDecoder().decode(GuidanceProposalResponse.self, from: Data(Self.questionsJSON.utf8))
        guard case .needsInformation(let questions, _) = response else { return XCTFail("Expected questions") }

        XCTAssertEqual(questions.map(\.kind), [.folder, .schedule, .confirmation])
        XCTAssertTrue(questions.allSatisfy(\.isRequired))
    }

    func testProposalRequestEncodesAnswersAndConnectionState() throws {
        let request = GuidanceProposalRequest(
            request: "Summarize GitHub",
            timezone: "Europe/Lisbon",
            connectedServices: [GuidanceConnectedService(
                id: "runtime:claude.ai%20GitHub",
                serviceId: "github",
                name: "GitHub (Claude account)",
                source: "account",
                actions: ["read"]
            )],
            availableCalendars: [
                GuidanceCalendarResource(id: "work-id", name: "Work", account: "iCloud", canModify: true)
            ],
            availableReminderLists: [
                GuidanceReminderListResource(id: "personal-id", name: "Personal", account: "iCloud", canModify: true)
            ],
            availableContactGroups: [
                GuidanceContactGroupResource(id: "family-id", name: "Family", account: "iCloud")
            ],
            answers: [GuidanceProposalAnswer(questionId: "send", value: .boolean(true))]
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        let answers = try XCTUnwrap(object["answers"] as? [[String: Any]])

        XCTAssertEqual(Set(object.keys), Set([
            "request", "timezone", "connected_services", "available_calendars", "available_reminder_lists", "available_contact_groups", "answers"
        ]))
        let services = try XCTUnwrap(object["connected_services"] as? [[String: Any]])
        XCTAssertEqual(services.first?["id"] as? String, "runtime:claude.ai%20GitHub")
        XCTAssertEqual(services.first?["service_id"] as? String, "github")
        XCTAssertEqual(services.first?["source"] as? String, "account")
        XCTAssertEqual(services.first?["actions"] as? [String], ["read"])
        let calendars = try XCTUnwrap(object["available_calendars"] as? [[String: Any]])
        XCTAssertEqual(calendars.first?["id"] as? String, "work-id")
        XCTAssertEqual(calendars.first?["can_modify"] as? Bool, true)
        let reminderLists = try XCTUnwrap(object["available_reminder_lists"] as? [[String: Any]])
        XCTAssertEqual(reminderLists.first?["id"] as? String, "personal-id")
        XCTAssertEqual(reminderLists.first?["can_modify"] as? Bool, true)
        let contactGroups = try XCTUnwrap(object["available_contact_groups"] as? [[String: Any]])
        XCTAssertEqual(contactGroups.first?["id"] as? String, "family-id")
        XCTAssertEqual(answers.first?["question_id"] as? String, "send")
        XCTAssertEqual(answers.first?["value"] as? Bool, true)
    }

    func testServiceRegistryKeepsExactNotionIdentityAndAllowedActions() throws {
        let response = try JSONDecoder().decode(
            GuidanceServiceRegistryResponse.self,
            from: Data(Self.serviceRegistryJSON.utf8)
        )

        XCTAssertEqual(response.connections.map(\.name), ["Personal Notion", "Notion (Claude account)", "Contacts"])
        XCTAssertEqual(
            response.connectedServices,
            [
                GuidanceConnectedService(
                    id: "mcp:notion-personal:abc123",
                    serviceId: "notion",
                    name: "Personal Notion",
                    source: "configured_api",
                    actions: ["read", "write"]
                ),
                GuidanceConnectedService(
                    id: "runtime:claude.ai%20Notion",
                    serviceId: "notion",
                    name: "Notion (Claude account)",
                    source: "account",
                    actions: ["read", "write"]
                ),
            ]
        )
    }

    func testDiagnosisMapsRecommendationWithoutInventingApplicablePatch() throws {
        let payload = try JSONDecoder().decode(GuidanceDiagnosticPayload.self, from: Data(Self.diagnosisJSON.utf8))
        let diagnosis = payload.presentation

        XCTAssertEqual(diagnosis.title, "The agent could not write the report.")
        XCTAssertEqual(diagnosis.recommendedFix?.title, "Allow report edits")
        XCTAssertFalse(diagnosis.recommendedFix?.canApply ?? true)
        XCTAssertEqual(diagnosis.evidence.first, "Write access: The Reports folder is read-only.")
    }

    func testGuidanceRoutesUsePostAndEscapeBoundIdentifiers() {
        XCTAssertEqual(GuidanceServerRoute.createProposal.path, "/guidance/agent-proposals")
        XCTAssertEqual(GuidanceServerRoute.saveProposal("id/one").path, "/guidance/agent-proposals/id%2Fone/save")
        XCTAssertEqual(GuidanceServerRoute.diagnosis("run/one").path, "/guidance/runs/run%2Fone/diagnosis")
        XCTAssertEqual(GuidanceServerRoute.retry("run/one").path, "/guidance/runs/run%2Fone/retry")
        XCTAssertEqual(GuidanceServerRoute.safeTest("agent/one").path, "/agents/agent%2Fone/safe-test")
        XCTAssertEqual(
            GuidanceServerRoute.similarProposal("agent/one").path,
            "/guidance/agents/agent%2Fone/similar-proposals"
        )
        XCTAssertTrue(GuidanceServerRoute.allCasesUsePost)
    }

    func testValidatedPatchUsesServerPreviewAndConfirmationWithoutChangingPayload() throws {
        let payload = try JSONDecoder().decode(GuidanceDiagnosticPayload.self, from: Data(Self.patchDiagnosisJSON.utf8))
        let preview = try JSONDecoder().decode(GuidancePatchPreview.self, from: Data(Self.previewJSON.utf8))
        let presentation = payload.presentation(with: preview)

        XCTAssertTrue(presentation.recommendedFix?.canApply == true)
        XCTAssertEqual(presentation.recommendedFix?.changes, ["Allow edits only in Documents/Reports"])
        let patch = try XCTUnwrap(payload.validatedPatch)
        let confirmed = patch.confirming(previewContentHash: preview.resultContentHash)
        XCTAssertEqual(confirmed.changes, patch.changes)
        XCTAssertEqual(confirmed.confirmation?.previewContentHash, preview.resultContentHash)
    }

    private static let serviceRegistryJSON = """
    {
      "connections": [
        {"id":"mcp:notion-personal:abc123","service_id":"notion","name":"Personal Notion","source":"configured_api","status":"connected","actions":["read","write"],"actions_known":true},
        {"id":"runtime:claude.ai%20Notion","service_id":"notion","name":"Notion (Claude account)","source":"account","status":"connected","actions":["read","write"],"actions_known":true},
        {"id":"macos:contacts","service_id":"contacts","name":"Contacts","source":"macos","status":"needs_setup","actions":["read"],"actions_known":true}
      ]
    }
    """

    private static let proposalJSON = """
    {"status":"proposal","usedFallback":false,"proposal_id":"proposal-1","proposal":{
      "schema_version":1,"name":"Friday summary","description":"A weekly summary","instructions":"Summarize activity.","explanation":"Reviews GitHub and sends a summary.",
      "trigger":{"type":"schedule","schedule":"0 17 * * 5","human_description":"Every Friday at 5:00 p.m."},"timezone":"Europe/Lisbon",
      "capabilities":[],"connections":[{"id":"slack","name":"Slack","required":true,"status":"needs_setup","reason":"Sends the summary"}],
      "file_access":[{"path":"~/Documents/Reports","access":"read_only","is_suggestion":false,"reason":"Reads reports"}],
      "calendar_access":[{"id":"work-id","name":"Work","account":"iCloud","access":"read_only","reason":"Reads work events"}],
      "native_services":{"reminders":{"resources":[{"id":"book-ideas-id","name":"Book ideas","account":"Personal","actions":["read","create","complete"]}]},"contacts":{"resources":[{"id":"family-id","name":"Family","account":"iCloud","actions":["read"],"fields":["name","birthday"]}]}},
      "permissions":{"can_modify_files":false,"can_run_commands":false,"requires_network":true,"can_use_connected_apps":true,"can_send_messages":true},
      "notification_destination":{"kind":"slack","label":"Slack","configured":false},"runtime":null,
      "risk":{"level":"needs_review","reasons":["External messaging"],"finding_count":1},"missing_information":[],"questions":[],"markdown_instructions":"# Friday summary"
    }}
    """

    private static let questionsJSON = """
    {"status":"needs_information","questions":[
      {"id":"folder","question":"Which folder?","control":"path","required":true},
      {"id":"time","question":"When should it run?","control":"schedule","required":true},
      {"id":"edit","question":"May it edit files?","control":"permission","required":true}
    ],"explanation":"A few details are needed.","usedFallback":true,"modelStatus":"unavailable"}
    """

    private static let diagnosisJSON = """
    {"schema_version":1,"run_id":"run-1","summary":"The agent could not write the report.","most_likely_cause":"The folder is read-only.","confidence":1,
      "evidence":[{"code":"write","label":"Write access","detail":"The Reports folder is read-only.","source":"configuration"}],
      "suggested_fix":{"id":"allow-write","label":"Allow report edits","description":"Allow changes only in Reports.","kind":"configuration_patch","risk":"needs_review","requires_confirmation":true,"affects_functionality":false},
      "affected_settings":["Reports folder"],"risk":"needs_review","can_automate":true,"rerun_safety":"confirm","alternatives":[],"next_step":"Review file access.","source":"deterministic"}
    """

    private static let patchDiagnosisJSON = """
    {"schema_version":1,"run_id":"run-1","summary":"The agent could not write the report.","most_likely_cause":"The folder is read-only.","confidence":1,
      "evidence":[],"suggested_fix":{"label":"Allow report edits","description":"Allow changes only in Reports.","risk":"needs_review"},
      "affected_settings":["Reports folder"],"risk":"needs_review","can_automate":true,"next_step":"Review file access.","source":"deterministic",
      "resolution":{"type":"configuration_patch","preview_endpoint":"/configuration-patches/preview","apply_endpoint":"/configuration-patches/apply","confirmation_required":true,
        "patch":{"schema_version":1,"agent_id":"agent-1","expected_content_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":"debugger","reason":"Allow the expected report","changes":{"working_directory":"~/Documents/Reports"}}}}
    """

    private static let previewJSON = """
    {"result_content_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changes":[{"field":"working_directory","summary":"Allow edits only in Documents/Reports"}],"advanced_changes":{"working_directory":"~/Documents/Reports"},"risk":"high","requires_confirmation":true,"can_apply":true}
    """
}
