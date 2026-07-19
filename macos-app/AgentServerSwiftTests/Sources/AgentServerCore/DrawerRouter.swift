import Foundation

// MARK: - Drawer state

enum Drawer: Equatable {
    case creation(sourceAgentId: String? = nil)
    case detail(agentId: String)
    case settings
    case connections
    case security(agentId: String?)
    case debugger(runId: String)
}

enum DrawerPresentationPlacement: Equatable {
    case mainPaneLeading
    case windowTop
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

    func openCreation(sourceAgentId: String? = nil) {
        open = .creation(sourceAgentId: sourceAgentId)
    }

    func openSettings() {
        open = .settings
    }

    func openConnections() {
        open = .connections
    }

    func openSecurity(agentId: String? = nil) {
        open = .security(agentId: agentId)
    }

    func openDebugger(runId: String) {
        open = .debugger(runId: runId)
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

    func closeSecurity() {
        if let agentId = securityAgentId {
            open = .detail(agentId: agentId)
        } else {
            open = nil
        }
    }

    // MARK: Queries

    var isDetailOpen: Bool {
        if case .detail = open { return true }
        return false
    }

    var isCreationOpen: Bool {
        if case .creation = open { return true }
        return false
    }

    var isSettingsOpen: Bool {
        open == .settings
    }

    var isConnectionsOpen: Bool {
        open == .connections
    }

    var isSecurityOpen: Bool {
        if case .security = open { return true }
        return false
    }

    var isDebuggerOpen: Bool {
        if case .debugger = open { return true }
        return false
    }

    var securityAgentId: String? {
        if case .security(let id) = open { return id }
        return nil
    }

    var debugRunId: String? {
        if case .debugger(let id) = open { return id }
        return nil
    }

    var creationSourceAgentId: String? {
        if case .creation(let id) = open { return id }
        return nil
    }

    var openAgentId: String? {
        if case .detail(let id) = open { return id }
        return nil
    }

    var presentationPlacement: DrawerPresentationPlacement? {
        switch open {
        case .creation, .detail:
            return .mainPaneLeading
        case .settings, .connections, .security, .debugger:
            return .windowTop
        case nil:
            return nil
        }
    }
}

// MARK: - Agent settings selection

/// Keeps an open settings draft tied to the agent that seeded it. A selection
/// change must close the editor before the new agent identifier can be paired
/// with the old draft.
enum AgentSettingsSelectionPolicy {
    static func shouldDismissSettings(
        previousAgentId: String,
        selectedAgentId: String
    ) -> Bool {
        previousAgentId != selectedAgentId
    }

    static func canSaveDraft(
        seededAgentId: String?,
        targetAgentId: String
    ) -> Bool {
        seededAgentId == targetAgentId
    }
}
