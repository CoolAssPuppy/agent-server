import Foundation

public protocol NativeToolService: AnyObject {
    var names: Set<String> { get }
    func call(name: String, arguments: [String: Any]) throws -> String
}

public enum NativeToolDispatchError: Error, Equatable {
    case methodNotFound(String)
}

public final class NativeToolDispatcher {
    private let services: [NativeToolService]

    public init(services: [NativeToolService]) {
        self.services = services
    }

    public func call(name: String, arguments: [String: Any]) throws -> String {
        guard let service = services.first(where: { $0.names.contains(name) }) else {
            throw NativeToolDispatchError.methodNotFound(name)
        }
        return try service.call(name: name, arguments: arguments)
    }
}
