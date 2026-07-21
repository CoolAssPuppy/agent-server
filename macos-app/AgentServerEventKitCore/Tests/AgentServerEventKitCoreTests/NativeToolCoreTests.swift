import Foundation
import XCTest

@testable import AgentServerEventKitCore

final class NativeToolCoreTests: XCTestCase {
    func testPaginationUsesBoundedDefaultAndReturnsContinuation() throws {
        let page = try PaginationPolicy(defaultLimit: 2, maximumLimit: 3).page(
            Array(0..<5),
            limit: nil,
            cursor: nil
        )

        XCTAssertEqual(page.items, [0, 1])
        XCTAssertEqual(page.metadata.limit, 2)
        XCTAssertEqual(page.metadata.nextCursor, "2")
        XCTAssertTrue(page.metadata.hasMore)
    }

    func testPaginationCapsRequestedLimitAndContinuesFromCursor() throws {
        let page = try PaginationPolicy(defaultLimit: 2, maximumLimit: 3).page(
            Array(0..<7),
            limit: 50,
            cursor: "3"
        )

        XCTAssertEqual(page.items, [3, 4, 5])
        XCTAssertEqual(page.metadata.limit, 3)
        XCTAssertEqual(page.metadata.nextCursor, "6")
    }

    func testPaginationRejectsInvalidCursor() {
        XCTAssertThrowsError(
            try PaginationPolicy(defaultLimit: 2, maximumLimit: 3).page(
                [1, 2],
                limit: nil,
                cursor: "not-a-cursor"
            )
        ) { error in
            XCTAssertEqual(error as? PaginationError, .invalidCursor)
        }
    }

    func testBoundedCallbackReturnsCompletedValue() throws {
        let result: String = try BoundedCallback.wait(timeout: 0.2) { complete in
            complete(.success("granted"))
        }

        XCTAssertEqual(result, "granted")
    }

    func testBoundedCallbackReturnsTimeoutInsteadOfWaitingForever() {
        XCTAssertThrowsError(
            try BoundedCallback.wait(timeout: 0.01) { (_: @escaping (Result<String, Error>) -> Void) in }
        ) { error in
            XCTAssertEqual(error as? BoundedCallbackError, .timedOut)
        }
    }

    func testBoundedCallbackIgnoresDuplicateCompletions() throws {
        let result: String = try BoundedCallback.wait(timeout: 0.2) { complete in
            complete(.success("first"))
            complete(.success("second"))
        }

        XCTAssertEqual(result, "first")
    }

    func testDispatcherExecutesInjectedProductionServiceContract() throws {
        let service = StubToolService(names: ["list_events"], response: "events")
        let dispatcher = NativeToolDispatcher(services: [service])

        XCTAssertEqual(try dispatcher.call(name: "list_events", arguments: [:]), "events")
        XCTAssertEqual(service.calls, ["list_events"])
    }

    func testDispatcherRejectsUnknownTool() {
        let dispatcher = NativeToolDispatcher(services: [])

        XCTAssertThrowsError(try dispatcher.call(name: "unknown", arguments: [:])) { error in
            XCTAssertEqual(error as? NativeToolDispatchError, .methodNotFound("unknown"))
        }
    }

    func testCatalogAppliesPaginationSchemaToEverySensitiveList() throws {
        let tools = NativeToolCatalog(pagination: .init(defaultLimit: 25, maximumLimit: 100)).tools

        for name in ["list_events", "list_reminders", "list_contacts"] {
            let tool = try XCTUnwrap(tools.first { $0.name == name })
            let properties = try XCTUnwrap(tool.inputSchema["properties"] as? [String: Any])
            let limit = try XCTUnwrap(properties["limit"] as? [String: Any])
            XCTAssertEqual(limit["maximum"] as? Int, 100)
            XCTAssertNotNil(properties["cursor"])
        }
    }
}

private final class StubToolService: NativeToolService {
    let names: Set<String>
    private let response: String
    private(set) var calls: [String] = []

    init(names: Set<String>, response: String) {
        self.names = names
        self.response = response
    }

    func call(name: String, arguments: [String: Any]) throws -> String {
        calls.append(name)
        return response
    }
}
