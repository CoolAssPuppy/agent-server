import Foundation

public enum LocalServerEndpoint {
    private static let host = "127.0.0.1"

    public static func httpURL(port: Int) -> URL? {
        URL(string: "http://\(host):\(port)")
    }

    public static func webSocketURL(port: Int) -> URL? {
        URL(string: "ws://\(host):\(port)/ws")
    }
}

/// Bounded exponential retry timing for the local progress stream.
struct WebSocketReconnectPolicy {
    let initialDelay: TimeInterval
    let maximumDelay: TimeInterval

    init(initialDelay: TimeInterval = 1, maximumDelay: TimeInterval = 30) {
        self.initialDelay = max(0, initialDelay)
        self.maximumDelay = max(0, maximumDelay)
    }

    func delay(afterFailureCount failureCount: Int) -> TimeInterval {
        guard failureCount > 0, initialDelay > 0, maximumDelay > 0 else { return 0 }

        var delay = min(initialDelay, maximumDelay)
        for _ in 1..<failureCount {
            delay = min(delay * 2, maximumDelay)
            if delay == maximumDelay { break }
        }
        return delay
    }
}

/// Minimal connection lifecycle state. Starting a task does not prove that
/// the WebSocket handshake succeeded; only `confirmedOpen` resets backoff.
struct WebSocketReconnectState {
    private(set) var failureCount = 0
    private(set) var isOpen = false
    private let policy: WebSocketReconnectPolicy

    init(policy: WebSocketReconnectPolicy = WebSocketReconnectPolicy()) {
        self.policy = policy
    }

    mutating func startedConnecting() {
        isOpen = false
    }

    mutating func confirmedOpen() {
        failureCount = 0
        isOpen = true
    }

    mutating func recordFailure() -> TimeInterval {
        isOpen = false
        if failureCount < Int.max {
            failureCount += 1
        }
        return policy.delay(afterFailureCount: failureCount)
    }

    mutating func reset() {
        failureCount = 0
        isOpen = false
    }
}

/// Coalesces any number of requests made while work is active into exactly one
/// follow-up pass. This prevents older network snapshots from committing after
/// newer ones while still honoring events that arrive mid-request.
struct CoalescingRequestState {
    private var isActive = false
    private var isPending = false

    mutating func request() -> Bool {
        guard !isActive else {
            isPending = true
            return false
        }
        isActive = true
        return true
    }

    mutating func complete() -> Bool {
        if isPending {
            isPending = false
            return true
        }
        isActive = false
        return false
    }

    mutating func reset() {
        isActive = false
        isPending = false
    }
}

enum MonitorPollFailureKind: Equatable {
    case reachability
    case authenticationSetup
    case responseSchema
    case serverResponse
}

/// Only network transport failures indicate that the daemon cannot be
/// reached. Decode and HTTP response failures need visible diagnostics, but
/// restarting the same daemon cannot repair them.
enum MonitorPollFailureClassifier {
    static func kind(for error: Error) -> MonitorPollFailureKind {
        if error is LocalAPIAuthenticationError {
            return .authenticationSetup
        }
        if error is DecodingError {
            return .responseSchema
        }
        if let urlError = error as? URLError, urlError.code != .cancelled {
            return .reachability
        }
        return .serverResponse
    }
}
