import Foundation

// MARK: - Drawer state

enum Drawer: Equatable {
    case detail(agentId: String)
    case settings
}

// MARK: - Router

/// Governs which drawer (if any) is open in the main window. Only one drawer
/// may be open at a time; `open(_:)` and the convenience mutators enforce
/// that invariant with a single published property.
final class DrawerRouter: ObservableObject {
    @Published private(set) var open: Drawer?

    init(open: Drawer? = nil) {
        self.open = open
    }

    // MARK: Opening

    func openDetail(agentId: String) {
        if case .detail(let current) = open, current == agentId {
            open = nil
            return
        }
        open = .detail(agentId: agentId)
    }

    func openSettings() {
        open = .settings
    }

    // MARK: Closing

    func close() {
        open = nil
    }

    // MARK: Queries

    var isDetailOpen: Bool {
        if case .detail = open { return true }
        return false
    }

    var isSettingsOpen: Bool {
        open == .settings
    }

    var openAgentId: String? {
        if case .detail(let id) = open { return id }
        return nil
    }
}
