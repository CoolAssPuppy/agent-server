import AgentServerEventKitCore
import Contacts
import EventKit
import Foundation

final class NativeAuthorization {
    private let store: EKEventStore
    private let contactStore: CNContactStore
    private let timeout: TimeInterval

    init(store: EKEventStore, contactStore: CNContactStore, timeout: TimeInterval) {
        self.store = store
        self.contactStore = contactStore
        self.timeout = timeout
    }

    func ensureEventAccess() throws { try ensureAccess(for: .event, label: "Calendar") }
    func ensureReminderAccess() throws { try ensureAccess(for: .reminder, label: "Reminder") }

    func ensureContactAccess() throws {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized, .limited: return
        case .denied, .restricted:
            throw MCPError.toolFailed("Contacts access denied. Grant permission in System Settings > Privacy & Security > Contacts.")
        case .notDetermined:
            let granted: Bool = try awaitResult(label: "Contacts access request") { completion in
                self.contactStore.requestAccess(for: .contacts) { granted, error in
                    error.map { completion(.failure($0)) } ?? completion(.success(granted))
                }
            }
            if !granted { throw MCPError.toolFailed("Contacts access not granted.") }
        @unknown default: throw MCPError.toolFailed("Contacts access is unavailable.")
        }
    }

    func fetchReminders(matching predicate: NSPredicate) throws -> [EKReminder] {
        try awaitResult(label: "Reminder fetch") { completion in
            self.store.fetchReminders(matching: predicate) { completion(.success($0 ?? [])) }
        }
    }

    private func ensureAccess(for entity: EKEntityType, label: String) throws {
        switch EKEventStore.authorizationStatus(for: entity) {
        case .fullAccess: return
        case .denied, .restricted:
            throw MCPError.toolFailed("\(label) access denied. Grant permission in System Settings > Privacy & Security > \(label)s.")
        case .writeOnly, .notDetermined: break
        @unknown default: break
        }
        let granted: Bool = try awaitResult(label: "Access request") { completion in
            let callback: (Bool, Error?) -> Void = { granted, error in
                error.map { completion(.failure($0)) } ?? completion(.success(granted))
            }
            if entity == .event { self.store.requestFullAccessToEvents(completion: callback) }
            else { self.store.requestFullAccessToReminders(completion: callback) }
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
