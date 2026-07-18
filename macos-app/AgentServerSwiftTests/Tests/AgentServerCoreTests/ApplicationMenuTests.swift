import AppKit
import XCTest
@testable import AgentServerCore

@MainActor
final class ApplicationMenuTests: XCTestCase {
    func testRepairsMissingOrIncompleteEditCommands() {
        XCTAssertTrue(ApplicationMenuPolicy.needsEditMenuInstallation(actionNames: []))
        XCTAssertTrue(ApplicationMenuPolicy.needsEditMenuInstallation(actionNames: ["copy:", "paste:"]))
        XCTAssertFalse(ApplicationMenuPolicy.needsEditMenuInstallation(actionNames: [
            "undo:", "cut:", "copy:", "paste:", "selectAll:",
        ]))
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
