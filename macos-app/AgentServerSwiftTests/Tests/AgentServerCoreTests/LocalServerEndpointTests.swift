import XCTest
@testable import AgentServerCore

final class LocalServerEndpointTests: XCTestCase {
    func testUsesTheIPv4LoopbackAddressBoundByTheDaemon() {
        XCTAssertEqual(LocalServerEndpoint.httpURL(port: 47821)?.absoluteString, "http://127.0.0.1:47821")
        XCTAssertEqual(LocalServerEndpoint.webSocketURL(port: 47821)?.absoluteString, "ws://127.0.0.1:47821/ws")
    }
}
