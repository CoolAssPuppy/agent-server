import Contacts
import EventKit
import XCTest

final class NativeToolServiceTests: XCTestCase {
    func testCalendarListingBoundsFrameworkResultsBeforeMappingAndPaging() throws {
        let store = EKEventStore()
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = "Work"
        let events = (0..<3).map { index -> EKEvent in
            let event = EKEvent(eventStore: store)
            event.title = "Event \(index)"
            event.startDate = Date(timeIntervalSince1970: TimeInterval(index))
            event.endDate = event.startDate.addingTimeInterval(60)
            event.calendar = calendar
            return event
        }
        let authorization = AuthorizationStub()
        let dependencies = EventKitDependencies(
            store: store,
            authorization: authorization,
            eventFetcher: { _ in events }
        )

        let result = try CalendarToolService(dependencies: dependencies).call(
            name: "list_events",
            arguments: [
                "start": "2024-01-01T00:00:00Z",
                "end": "2025-01-01T00:00:00Z",
                "limit": 2,
            ]
        )
        let object = try jsonObject(result)

        XCTAssertEqual((object["events"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual((object["pagination"] as? [String: Any])?["hasMore"] as? Bool, true)
        XCTAssertEqual(authorization.eventAccessRequests, 1)
    }

    func testReminderListingBoundsUnavoidableCallbackResultsBeforeMapping() throws {
        let store = EKEventStore()
        let calendar = EKCalendar(for: .reminder, eventStore: store)
        calendar.title = "Tasks"
        let reminders = (0..<3).map { index -> EKReminder in
            let reminder = EKReminder(eventStore: store)
            reminder.title = "Reminder \(index)"
            reminder.calendar = calendar
            return reminder
        }
        let authorization = AuthorizationStub(reminders: reminders)
        let dependencies = EventKitDependencies(store: store, authorization: authorization)

        let result = try ReminderToolService(dependencies: dependencies).call(
            name: "list_reminders",
            arguments: ["limit": 2]
        )
        let object = try jsonObject(result)

        XCTAssertEqual((object["reminders"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual((object["pagination"] as? [String: Any])?["hasMore"] as? Bool, true)
        XCTAssertEqual(authorization.reminderAccessRequests, 1)
        XCTAssertEqual(authorization.reminderFetchRequests, 1)
    }

    func testContactListingStopsEnumerationAtThePageLookaheadBoundary() throws {
        var requestedMaximum = 0
        let contact = CNMutableContact()
        contact.givenName = "Ada"
        contact.familyName = "Lovelace"
        let authorization = AuthorizationStub()
        let dependencies = EventKitDependencies(
            grantPolicy: scopedContactPolicy,
            authorization: authorization,
            contactFetcher: { _, _, maximum in
                requestedMaximum = maximum
                return (0..<maximum).map { _ in contact }
            }
        )

        let result = try ContactsToolService(dependencies: dependencies).call(
            name: "list_contacts",
            arguments: ["groupId": "group-1", "limit": 2]
        )
        let object = try jsonObject(result)

        XCTAssertEqual(requestedMaximum, 3)
        XCTAssertEqual((object["contacts"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual((object["pagination"] as? [String: Any])?["hasMore"] as? Bool, true)
        XCTAssertEqual(authorization.contactAccessRequests, 1)
    }

    func testContactListingPreservesPaginationValidationErrors() {
        let dependencies = EventKitDependencies(
            grantPolicy: scopedContactPolicy,
            authorization: AuthorizationStub(),
            contactFetcher: { _, _, _ in [] }
        )

        XCTAssertThrowsError(
            try ContactsToolService(dependencies: dependencies).call(
                name: "list_contacts",
                arguments: ["groupId": "group-1", "limit": 0]
            )
        ) { error in
            guard case MCPError.invalidParams(let message) = error else {
                return XCTFail("Expected an invalid-parameters error, got \(error)")
            }
            XCTAssertEqual(message, "limit must be greater than zero")
        }
    }

    func testNativeAuthorizationUsesInjectedFrameworkCallbacks() throws {
        let reminder = EKReminder(eventStore: EKEventStore())
        let authorization = NativeAuthorization(
            timeout: 0.1,
            operations: NativeAuthorizationOperations(
                eventStatus: { _ in .notDetermined },
                contactStatus: { .notDetermined },
                requestEventAccess: { $0(true, nil) },
                requestReminderAccess: { $0(true, nil) },
                requestContactAccess: { $0(true, nil) },
                fetchReminders: { _, completion in completion([reminder]) }
            )
        )

        XCTAssertNoThrow(try authorization.ensureEventAccess())
        XCTAssertNoThrow(try authorization.ensureReminderAccess())
        XCTAssertNoThrow(try authorization.ensureContactAccess())
        XCTAssertEqual(try authorization.fetchReminders(matching: NSPredicate(value: true)).count, 1)
    }

    func testNativeAuthorizationBoundsFrameworkCallbacksThatNeverComplete() {
        let authorization = NativeAuthorization(
            timeout: 0.01,
            operations: NativeAuthorizationOperations(
                eventStatus: { _ in .notDetermined },
                contactStatus: { .notDetermined },
                requestEventAccess: { _ in },
                requestReminderAccess: { _ in },
                requestContactAccess: { _ in },
                fetchReminders: { _, _ in }
            )
        )

        XCTAssertThrowsError(try authorization.ensureEventAccess()) { error in
            XCTAssertTrue(error.localizedDescription.contains("timed out"))
        }
    }

    private var scopedContactPolicy: NativeServiceGrantPolicy {
        NativeServiceGrantPolicy(environmentValue: """
        {"version":1,"services":{"contacts":{"resources":[{"id":"group-1","name":"People","actions":["read"],"fields":["name"]}]}}}
        """)
    }

    private func jsonObject(_ value: String) throws -> [String: Any] {
        let data = try XCTUnwrap(value.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

private final class AuthorizationStub: NativeAuthorizationProviding {
    private(set) var eventAccessRequests = 0
    private(set) var reminderAccessRequests = 0
    private(set) var contactAccessRequests = 0
    private(set) var reminderFetchRequests = 0
    private let reminders: [EKReminder]

    init(reminders: [EKReminder] = []) { self.reminders = reminders }

    func ensureEventAccess() throws { eventAccessRequests += 1 }
    func ensureReminderAccess() throws { reminderAccessRequests += 1 }
    func ensureContactAccess() throws { contactAccessRequests += 1 }

    func fetchReminders(matching predicate: NSPredicate) throws -> [EKReminder] {
        reminderFetchRequests += 1
        return reminders
    }
}
