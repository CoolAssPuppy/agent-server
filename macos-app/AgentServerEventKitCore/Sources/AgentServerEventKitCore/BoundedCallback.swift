import Foundation

public enum BoundedCallbackError: Error, Equatable {
    case timedOut
}

public enum BoundedCallback {
    public static func wait<Value>(
        timeout: TimeInterval,
        start: (@escaping (Result<Value, Error>) -> Void) -> Void
    ) throws -> Value {
        let state = CallbackState<Value>()
        let semaphore = DispatchSemaphore(value: 0)

        start { result in
            guard state.complete(result) else { return }
            semaphore.signal()
        }

        guard semaphore.wait(timeout: .now() + timeout) == .success else {
            throw BoundedCallbackError.timedOut
        }
        guard let result = state.result() else { throw BoundedCallbackError.timedOut }
        return try result.get()
    }
}

private final class CallbackState<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<Value, Error>?

    func complete(_ result: Result<Value, Error>) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value == nil else { return false }
        value = result
        return true
    }

    func result() -> Result<Value, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
