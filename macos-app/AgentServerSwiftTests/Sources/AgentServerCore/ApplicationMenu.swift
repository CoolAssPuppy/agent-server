import AppKit

public enum ApplicationMenuPolicy {
    private static let requiredEditActions = Set(["cut:", "copy:", "paste:", "selectAll:"])

    public static func needsEditMenuInstallation(actionNames: [String]) -> Bool {
        !requiredEditActions.isSubset(of: Set(actionNames))
    }
}

public enum StandardEditMenu {
    @MainActor
    public static func make() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        menu.addItem(command("Undo", action: Selector(("undo:")), key: "z"))
        menu.addItem(command("Redo", action: Selector(("redo:")), key: "z", modifiers: [.command, .shift]))
        menu.addItem(.separator())
        menu.addItem(command("Cut", action: #selector(NSText.cut(_:)), key: "x"))
        menu.addItem(command("Copy", action: #selector(NSText.copy(_:)), key: "c"))
        menu.addItem(command("Paste", action: #selector(NSText.paste(_:)), key: "v"))
        menu.addItem(command("Select All", action: #selector(NSText.selectAll(_:)), key: "a"))
        return menu
    }

    @MainActor
    private static func command(
        _ title: String,
        action: Selector,
        key: String,
        modifiers: NSEvent.ModifierFlags = .command
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        return item
    }
}
