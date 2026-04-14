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
    /// Process-wide singleton. The menubar popover and the main window use
    /// the same instance so clicking the gear or an agent row in the popover
    /// routes into the main window's drawer layer.
    static let shared = DrawerRouter()

    @Published private(set) var open: Drawer?
    /// Route requested by the popover but not yet committed to `open`.
    /// MainWindow.onAppear consumes this inside `withAnimation` so the
    /// drawer transition plays on the initial insert.
    @Published var pending: Drawer?

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

    /// Sets the router to a specific drawer in one step. Used by AppDelegate
    /// when the popover routes into the main window.
    func routeTo(_ drawer: Drawer) {
        open = drawer
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
