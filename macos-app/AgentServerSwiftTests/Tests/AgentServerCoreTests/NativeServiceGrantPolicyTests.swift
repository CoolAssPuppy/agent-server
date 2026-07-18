import XCTest
@testable import AgentServerCore

final class NativeServiceGrantPolicyTests: XCTestCase {
    func testMissingScopeKeepsLegacyModeWhileMalformedScopeDeniesEverything() {
        let legacy = NativeServiceGrantPolicy(environmentValue: nil)
        XCTAssertEqual(legacy.mode, .legacy)
        XCTAssertFalse(legacy.permitsTool("list_contacts"))

        let malformed = NativeServiceGrantPolicy(environmentValue: "not-json")
        XCTAssertEqual(malformed.mode, .scoped)
        XCTAssertFalse(malformed.allows(service: .reminders, resourceId: "list-1", action: "read"))
        XCTAssertTrue(malformed.availableResourceIds(service: .calendar).isEmpty)
    }

    func testReminderActionsStayIndependentAndScopedToOneList() {
        let policy = NativeServiceGrantPolicy(environmentValue: """
        {"version":1,"services":{"reminders":{"resources":[
          {"id":"personal","name":"Personal","actions":["read","complete"]},
          {"id":"errands","name":"Errands","actions":["create"]}
        ]}}}
        """)

        XCTAssertTrue(policy.allows(service: .reminders, resourceId: "personal", action: "read"))
        XCTAssertTrue(policy.allows(service: .reminders, resourceId: "personal", action: "complete"))
        XCTAssertFalse(policy.allows(service: .reminders, resourceId: "personal", action: "create"))
        XCTAssertTrue(policy.allows(service: .reminders, resourceId: "errands", action: "create"))
        XCTAssertFalse(policy.allows(service: .calendar, resourceId: "personal", action: "read"))
        XCTAssertFalse(policy.allows(service: .calendar, resourceId: "personal", action: "delete"))
        XCTAssertEqual(policy.availableResourceIds(service: .reminders, action: "read"), ["personal"])
        XCTAssertTrue(policy.permitsTool("list_reminders"))
        XCTAssertTrue(policy.permitsTool("complete_reminder"))
        XCTAssertFalse(policy.permitsTool("create_event"))
        XCTAssertFalse(policy.permitsTool("delete_event"))
    }

    func testUnknownVersionAndDuplicateResourcesFailClosed() {
        let unknown = NativeServiceGrantPolicy(environmentValue: "{\"version\":2,\"services\":{}}")
        let duplicate = NativeServiceGrantPolicy(environmentValue: """
        {"version":1,"services":{"calendar":{"resources":[
          {"id":"work","name":"Work","actions":["read"]},
          {"id":"work","name":"Again","actions":["create"]}
        ]}}}
        """)

        XCTAssertTrue(unknown.availableResourceIds(service: .calendar).isEmpty)
        XCTAssertTrue(duplicate.availableResourceIds(service: .calendar).isEmpty)
    }

    func testContactsStayReadOnlyAndExposeOnlyApprovedFields() {
        let policy = NativeServiceGrantPolicy(environmentValue: """
        {"version":1,"services":{"contacts":{"resources":[
          {"id":"family","name":"Family","actions":["read"],"fields":["name","email"]}
        ]}}}
        """)

        XCTAssertTrue(policy.permitsTool("list_contacts"))
        XCTAssertFalse(policy.permitsTool("create_contact"))
        XCTAssertEqual(policy.availableFields(service: .contacts, resourceId: "family"), ["name", "email"])
    }
}
