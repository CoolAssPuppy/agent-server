import Foundation

public struct NativeServiceGrantPolicy: Sendable {
    public enum Mode: Equatable, Sendable {
        case legacy
        case scoped
    }

    public enum Service: String, Sendable {
        case calendar
        case reminders
        case contacts
    }

    private struct Envelope: Decodable {
        let version: Int
        let services: Services
    }

    private struct Services: Decodable {
        let calendar: Collection?
        let reminders: Collection?
        let contacts: Collection?
    }

    private struct Collection: Decodable {
        let resources: [Resource]
    }

    private struct Resource: Decodable {
        let id: String
        let name: String
        let actions: [String]
        let fields: [String]?
    }

    public let mode: Mode
    private let resources: [Service: [Resource]]

    public init(environmentValue: String?) {
        guard let environmentValue else {
            mode = .legacy
            resources = [:]
            return
        }
        mode = .scoped
        guard let data = environmentValue.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.version == 1,
              Self.isValid(envelope.services) else {
            resources = [:]
            return
        }
        resources = [
            .calendar: envelope.services.calendar?.resources ?? [],
            .reminders: envelope.services.reminders?.resources ?? [],
            .contacts: envelope.services.contacts?.resources ?? [],
        ]
    }

    public func allows(service: Service, resourceId: String, action: String) -> Bool {
        guard mode == .scoped else { return true }
        return resources[service]?.contains { $0.id == resourceId && $0.actions.contains(action) } == true
    }

    public func availableResourceIds(service: Service, action: String? = nil) -> [String] {
        guard mode == .scoped else { return [] }
        return (resources[service] ?? []).compactMap { resource in
            guard let action else { return resource.id }
            return resource.actions.contains(action) ? resource.id : nil
        }
    }

    public func permitsTool(_ name: String) -> Bool {
        guard mode == .scoped else { return name != "list_contacts" }
        let requirement: (Service, String)? = switch name {
        case "list_calendars", "list_events": (.calendar, "read")
        case "create_event": (.calendar, "create")
        case "update_event": (.calendar, "update")
        case "list_reminder_lists", "list_reminders": (.reminders, "read")
        case "create_reminder": (.reminders, "create")
        case "complete_reminder": (.reminders, "complete")
        case "list_contacts": (.contacts, "read")
        default: nil
        }
        guard let requirement else { return false }
        return !availableResourceIds(service: requirement.0, action: requirement.1).isEmpty
    }

    public func availableFields(service: Service, resourceId: String) -> [String] {
        guard mode == .scoped else { return [] }
        return resources[service]?.first(where: { $0.id == resourceId })?.fields ?? []
    }

    private static func isValid(_ services: Services) -> Bool {
        isValid(services.calendar?.resources ?? [], allowedActions: ["read", "create", "update"])
            && isValid(services.reminders?.resources ?? [], allowedActions: ["read", "create", "complete"])
            && isValid(services.contacts?.resources ?? [], allowedActions: ["read"], allowedFields: ["name", "email", "phone", "birthday"])
    }

    private static func isValid(
        _ resources: [Resource],
        allowedActions: Set<String>,
        allowedFields: Set<String>? = nil
    ) -> Bool {
        guard Set(resources.map(\.id)).count == resources.count else { return false }
        return resources.allSatisfy { resource in
            !resource.id.isEmpty
                && !resource.name.isEmpty
                && !resource.actions.isEmpty
                && Set(resource.actions).count == resource.actions.count
                && Set(resource.actions).isSubset(of: allowedActions)
                && (allowedFields == nil || (
                    resource.fields?.isEmpty == false
                    && Set(resource.fields ?? []).isSubset(of: allowedFields ?? [])
                    && Set(resource.fields ?? []).count == resource.fields?.count
                ))
        }
    }
}
