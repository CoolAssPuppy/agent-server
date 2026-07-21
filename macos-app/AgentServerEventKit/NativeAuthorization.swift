import AgentServerEventKitCore
import Contacts
import EventKit
import Foundation

final class NativeAuthorization: NativeAuthorizationProviding {
    private let timeout: TimeInterval
    private let eventStatus: (EKEntityType) -> EKAuthorizationStatus
    private let contactStatus: () -> CNAuthorizationStatus
    private let requestEventAccess: (@escaping (Bool, Error?) -> Void) -> Void
    private let requestReminderAccess: (@escaping (Bool, Error?) -> Void) -> Void
    private let requestContactAccess: (@escaping (Bool, Error?) -> Void) -> Void
    private let reminderFetcher: (NSPredicate, @escaping ([EKReminder]?) -> Void) -> Void

    init(store: EKEventStore, contactStore: CNContactStore, timeout: TimeInterval) {
        self.timeout = timeout
        eventStatus = { EKEventStore.authorizationStatus(for: $0) }
        contactStatus = { CNContactStore.authorizationStatus(for: .contacts) }
        requestEventAccess = { store.requestFullAccessToEvents(completion: $0) }
        requestReminderAccess = { store.requestFullAccessToReminders(completion: $0) }
        requestContactAccess = { contactStore.requestAccess(for: .contacts, completionHandler: $0) }
        reminderFetcher = { store.fetchReminders(matching: $0, completion: $1) }
    }

    init(
        timeout: TimeInterval,
        eventStatus: @escaping (EKEntityType) -> EKAuthorizationStatus,
        contactStatus: @escaping () -> CNAuthorizationStatus,
        requestEventAccess: @escaping (@escaping (Bool, Error?) -> Void) -> Void,
        requestReminderAccess: @escaping (@escaping (Bool, Error?) -> Void) -> Void,
        requestContactAccess: @escaping (@escaping (Bool, Error?) -> Void) -> Void,
        reminderFetcher: @escaping (NSPredicate, @escaping ([EKReminder]?) -> Void) -> Void
    ) {
        self.timeout = timeout
        self.eventStatus = eventStatus
        self.contactStatus = contactStatus
        self.requestEventAccess = requestEventAccess
        self.requestReminderAccess = requestReminderAccess
        self.requestContactAccess = requestContactAccess
        self.reminderFetcher = reminderFetcher
    }

    func ensureEventAccess() throws { try ensureAccess(for: .event, label: "Calendar") }
    func ensureReminderAccess() throws { try ensureAccess(for: .reminder, label: "Reminder") }

    func ensureContactAccess() throws {
        switch contactStatus() {
        case .authorized, .limited: return
        case .denied, .restricted:
            throw MCPError.toolFailed("Contacts access denied. Grant permission in System Settings > Privacy & Security > Contacts.")
        case .notDetermined:
            let granted: Bool = try awaitResult(label: "Contacts access request") { completion in
                self.requestContactAccess { granted, error in
                    if let error { completion(.failure(error)) }
                    else { completion(.success(granted)) }
                }
            }
            if !granted { throw MCPError.toolFailed("Contacts access not granted.") }
        @unknown default: throw MCPError.toolFailed("Contacts access is unavailable.")
        }
    }

    func fetchReminders(matching predicate: NSPredicate) throws -> [EKReminder] {
        try awaitResult(label: "Reminder fetch") { completion in
            self.reminderFetcher(predicate) { completion(.success($0 ?? [])) }
        }
    }

    private func ensureAccess(for entity: EKEntityType, label: String) throws {
        switch eventStatus(entity) {
        case .fullAccess: return
        case .denied, .restricted:
            throw MCPError.toolFailed("\(label) access denied. Grant permission in System Settings > Privacy & Security > \(label)s.")
        case .writeOnly, .notDetermined: break
        @unknown default: break
        }
        let granted: Bool = try awaitResult(label: "Access request") { completion in
            let callback: (Bool, Error?) -> Void = { granted, error in
                if let error { completion(.failure(error)) }
                else { completion(.success(granted)) }
            }
            if entity == .event { self.requestEventAccess(callback) }
            else { self.requestReminderAccess(callback) }
        }
        if !granted { throw MCPError.toolFailed("\(label) access not granted.") }
    }

    private func awaitResult<Value>(
        label: String,
        start: (@escaping (Result<Value, Error>) -> Void) -> Void
    ) throws -> Value {
        do { return try BoundedCallback.wait(timeout: timeout, start: start) }
        catch BoundedCallbackError.timedOut {
            throw MCPError.toolFailed("\(label) timed out after \(Int(timeout)) seconds")
        } catch { throw MCPError.toolFailed("\(label) failed: \(error.localizedDescription)") }
    }
}
