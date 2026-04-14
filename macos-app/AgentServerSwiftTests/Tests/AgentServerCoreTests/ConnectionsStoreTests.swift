import XCTest
@testable import AgentServerCore

final class ConnectionsStoreTests: XCTestCase {

    // MARK: Key regex

    func testValidScreamingSnakeKeysPass() {
        XCTAssertTrue(ConnectionsStore.isValidKey("AGENT_SERVER_PANEL_URL"))
        XCTAssertTrue(ConnectionsStore.isValidKey("FOO"))
        XCTAssertTrue(ConnectionsStore.isValidKey("FOO_BAR_1"))
        XCTAssertTrue(ConnectionsStore.isValidKey("A"))
    }

    func testInvalidKeysFail() {
        XCTAssertFalse(ConnectionsStore.isValidKey(""))
        XCTAssertFalse(ConnectionsStore.isValidKey("lowercase"))
        XCTAssertFalse(ConnectionsStore.isValidKey("1LEADING_DIGIT"))
        XCTAssertFalse(ConnectionsStore.isValidKey("_LEADING_UNDERSCORE"))
        XCTAssertFalse(ConnectionsStore.isValidKey("HAS SPACE"))
        XCTAssertFalse(ConnectionsStore.isValidKey("HAS-DASH"))
        XCTAssertFalse(ConnectionsStore.isValidKey("mixedCase"))
    }

    func testAllKeysValidReflectsInvalidEntry() {
        let store = ConnectionsStore(entries: [
            ConnectionEntry(key: "VALID_KEY", value: "x"),
            ConnectionEntry(key: "bad", value: "y"),
        ])
        XCTAssertFalse(store.allKeysValid)
    }

    // MARK: Masking

    func testSecretKeyDetection() {
        XCTAssertTrue(ConnectionsStore.isSecretKey("AGENT_SERVER_PANEL_API_KEY"))
        XCTAssertTrue(ConnectionsStore.isSecretKey("STRIPE_SECRET"))
        XCTAssertTrue(ConnectionsStore.isSecretKey("GITHUB_TOKEN"))
        XCTAssertFalse(ConnectionsStore.isSecretKey("AGENT_SERVER_PANEL_URL"))
        XCTAssertFalse(ConnectionsStore.isSecretKey("PUBLIC_ENDPOINT"))
    }

    func testMaskedValueShowsLastFourForSecretKeys() {
        let masked = ConnectionsStore.maskedValue(
            key: "AGENT_SERVER_PANEL_API_KEY",
            value: "sk_live_abcd1234"
        )
        XCTAssertEqual(masked, "••••1234")
    }

    func testMaskedValueForNonSecretKeyReturnsRaw() {
        let masked = ConnectionsStore.maskedValue(
            key: "AGENT_SERVER_PANEL_URL",
            value: "https://panel.example.com"
        )
        XCTAssertEqual(masked, "https://panel.example.com")
    }

    func testMaskedValueForShortSecretKeepsRaw() {
        let masked = ConnectionsStore.maskedValue(key: "X_KEY", value: "ab")
        XCTAssertEqual(masked, "ab")
    }

    // MARK: Required pair

    func testHasRequiredPanelPair() {
        let store = ConnectionsStore(entries: [
            ConnectionEntry(key: "AGENT_SERVER_PANEL_URL", value: "https://x"),
            ConnectionEntry(key: "AGENT_SERVER_PANEL_API_KEY", value: "sk_live_abcd"),
        ])
        XCTAssertTrue(store.hasRequiredPanelPair)
    }

    func testMissingRequiredPanelPair() {
        let store = ConnectionsStore(entries: [
            ConnectionEntry(key: "AGENT_SERVER_PANEL_URL", value: "https://x"),
        ])
        XCTAssertFalse(store.hasRequiredPanelPair)
    }

    // MARK: JSON roundtrip

    func testJSONRoundtripPreservesEntries() throws {
        let store = ConnectionsStore(entries: [
            ConnectionEntry(key: "AGENT_SERVER_PANEL_URL", value: "https://panel.example.com"),
            ConnectionEntry(key: "AGENT_SERVER_PANEL_API_KEY", value: "sk_live_abcd1234"),
            ConnectionEntry(key: "CUSTOM_FOO", value: "bar"),
        ])

        let data = try store.toJSONData()
        let reloaded = try ConnectionsStore.from(jsonData: data)

        let reloadedMap = Dictionary(uniqueKeysWithValues: reloaded.entries.map { ($0.key, $0.value) })
        XCTAssertEqual(reloadedMap["AGENT_SERVER_PANEL_URL"], "https://panel.example.com")
        XCTAssertEqual(reloadedMap["AGENT_SERVER_PANEL_API_KEY"], "sk_live_abcd1234")
        XCTAssertEqual(reloadedMap["CUSTOM_FOO"], "bar")
        XCTAssertEqual(reloaded.entries.count, 3)
    }

    func testAppendAddsEmptyRow() {
        let store = ConnectionsStore()
        store.append()
        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].key, "")
    }

    func testRemoveEntryById() {
        let store = ConnectionsStore()
        store.append(key: "A", value: "1")
        store.append(key: "B", value: "2")
        let targetId = store.entries[0].id
        store.remove(id: targetId)
        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].key, "B")
    }
}
