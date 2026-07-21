import AgentServerEventKitCore
import Contacts
import Foundation

final class ContactsToolService: NativeToolService {
    let names: Set<String> = ["list_contacts"]
    private let dependencies: EventKitDependencies

    init(dependencies: EventKitDependencies) { self.dependencies = dependencies }

    func call(name: String, arguments: [String: Any]) throws -> String {
        guard name == "list_contacts" else { throw NativeToolDispatchError.methodNotFound(name) }
        return try listContacts(args: arguments)
    }

    private func listContacts(args: [String: Any]) throws -> String {
        let approvedIds = dependencies.grantPolicy.availableResourceIds(service: .contacts, action: "read")
        let requestedId = (args["groupId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let groupId: String
        if let requestedId, !requestedId.isEmpty {
            groupId = requestedId
        } else if approvedIds.count == 1, let approvedId = approvedIds.first {
            groupId = approvedId
        } else {
            throw MCPError.invalidParams("Choose one approved Contacts group or account")
        }
        guard dependencies.grantPolicy.allows(service: .contacts, resourceId: groupId, action: "read") else {
            throw MCPError.invalidParams("That contact group is not available to this agent")
        }
        try dependencies.authorization.ensureContactAccess()

        let fields = Set(dependencies.grantPolicy.availableFields(service: .contacts, resourceId: groupId))
        var keys: [CNKeyDescriptor] = []
        if fields.contains("name") {
            keys.append(contentsOf: [CNContactGivenNameKey as CNKeyDescriptor, CNContactFamilyNameKey as CNKeyDescriptor])
        }
        if fields.contains("email") { keys.append(CNContactEmailAddressesKey as CNKeyDescriptor) }
        if fields.contains("phone") { keys.append(CNContactPhoneNumbersKey as CNKeyDescriptor) }
        if fields.contains("birthday") { keys.append(CNContactBirthdayKey as CNKeyDescriptor) }

        let predicate: NSPredicate
        if groupId.hasPrefix("container:") {
            predicate = CNContact.predicateForContactsInContainer(
                withIdentifier: String(groupId.dropFirst("container:".count))
            )
        } else {
            predicate = CNContact.predicateForContactsInGroup(withIdentifier: groupId)
        }
        do {
            let contacts = try dependencies.contacts(matching: predicate, keys: keys, args: args)
            return try response(contacts: contacts, fields: fields, args: args)
        } catch let error as MCPError {
            throw error
        } catch {
            throw MCPError.toolFailed("Failed to read the selected contact group: \(error.localizedDescription)")
        }
    }

    private func response(contacts: [CNContact], fields: Set<String>, args: [String: Any]) throws -> String {
        let values = contacts.map { contact -> [String: Any] in
            var value: [String: Any] = [:]
            if fields.contains("name") {
                value["name"] = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
            }
            if fields.contains("email") { value["emails"] = contact.emailAddresses.map { $0.value as String } }
            if fields.contains("phone") { value["phones"] = contact.phoneNumbers.map { $0.value.stringValue } }
            if fields.contains("birthday"), let birthday = contact.birthday {
                value["birthday"] = String(format: "%02d-%02d", birthday.month ?? 0, birthday.day ?? 0)
            }
            return value
        }
        let page = try dependencies.page(values, args: args)
        return try dependencies.jsonString(["contacts": page.items, "pagination": dependencies.paginationObject(page.metadata)])
    }

}
