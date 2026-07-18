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

enum MonitorPollFailureKind: Equatable {
    case reachability
    case responseSchema
    case serverResponse
}

/// Only network transport failures indicate that the daemon cannot be
/// reached. Decode and HTTP response failures need visible diagnostics, but
/// restarting the same daemon cannot repair them.
enum MonitorPollFailureClassifier {
    static func kind(for error: Error) -> MonitorPollFailureKind {
        if error is DecodingError {
            return .responseSchema
        }
        if let urlError = error as? URLError, urlError.code != .cancelled {
            return .reachability
        }
        return .serverResponse
    }
}
