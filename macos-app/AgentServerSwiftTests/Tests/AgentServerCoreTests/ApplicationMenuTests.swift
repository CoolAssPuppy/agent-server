import AppKit
import XCTest
@testable import AgentServerCore

@MainActor
final class ApplicationMenuTests: XCTestCase {
    func testFindsLocalizedMenusByActionsAndOnlySuppliesMissingEditCommands() {
        XCTAssertTrue(ApplicationMenuPolicy.isFileMenu(actionNames: ["openDocument:"]))
        XCTAssertTrue(ApplicationMenuPolicy.isEditMenu(actionNames: ["copy:", "find:"]))
        XCTAssertEqual(
            ApplicationMenuPolicy.missingEditActions(actionNames: ["copy:", "paste:"]),
            Set(["cut:", "selectAll:"])
        )

        let items = StandardEditMenu.requiredItems(missing: Set(["cut:", "selectAll:"]))
        XCTAssertEqual(Set(items.compactMap { $0.action.map(NSStringFromSelector) }), Set(["cut:", "selectAll:"]))
    }

    func testEditMenuUsesNativeResponderChainCommands() {
        let menu = StandardEditMenu.make()
        let commands = Dictionary(uniqueKeysWithValues: menu.items.compactMap { item in
            item.action.map { ($0, item) }
        })

        XCTAssertEqual(commands[#selector(NSText.cut(_:))]?.keyEquivalent, "x")
        XCTAssertEqual(commands[#selector(NSText.copy(_:))]?.keyEquivalent, "c")
        XCTAssertEqual(commands[#selector(NSText.paste(_:))]?.keyEquivalent, "v")
        XCTAssertEqual(commands[#selector(NSText.selectAll(_:))]?.keyEquivalent, "a")
        XCTAssertNil(commands[#selector(NSText.copy(_:))]?.target)
        XCTAssertEqual(commands[#selector(NSText.copy(_:))]?.keyEquivalentModifierMask, .command)
    }
}
