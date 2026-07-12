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
