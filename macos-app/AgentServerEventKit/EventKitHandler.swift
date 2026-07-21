import AgentServerEventKitCore
import Foundation

final class EventKitHandler: MCPHandler {
    private let dependencies: EventKitDependencies
    private let dispatcher: NativeToolDispatcher

    init(dependencies: EventKitDependencies = EventKitDependencies()) {
        self.dependencies = dependencies
        dispatcher = NativeToolDispatcher(services: [
            CalendarToolService(dependencies: dependencies),
            ReminderToolService(dependencies: dependencies),
            ContactsToolService(dependencies: dependencies),
        ])
    }

    func tools() -> [MCPTool] {
        NativeToolCatalog(pagination: dependencies.pagination).tools
            .filter { dependencies.grantPolicy.permitsTool($0.name) }
            .map { MCPTool(name: $0.name, description: $0.description, inputSchema: $0.inputSchema) }
    }

    func call(name: String, arguments: [String: Any]) throws -> String {
        guard dependencies.grantPolicy.permitsTool(name) else {
            throw MCPError.methodNotFound(name)
        }
        do {
            return try dispatcher.call(name: name, arguments: arguments)
        } catch NativeToolDispatchError.methodNotFound {
            throw MCPError.methodNotFound(name)
        }
    }
}
