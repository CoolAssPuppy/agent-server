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

public final class NativeToolClosureService: NativeToolService {
    public let names: Set<String>
    private let invoke: (String, [String: Any]) throws -> String

    public init(
        names: Set<String>,
        invoke: @escaping (String, [String: Any]) throws -> String
    ) {
        self.names = names
        self.invoke = invoke
    }

    public func call(name: String, arguments: [String: Any]) throws -> String {
        try invoke(name, arguments)
    }
}
