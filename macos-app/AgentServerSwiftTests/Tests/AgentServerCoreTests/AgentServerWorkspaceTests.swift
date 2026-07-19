import XCTest
@testable import AgentServerCore

final class AgentServerWorkspaceTests: XCTestCase {
    func testDefaultWorkspaceKeepsAgentsAndEnvironmentTogether() {
        let userHome = URL(fileURLWithPath: "/Users/example", isDirectory: true)

        let workspace = AgentServerWorkspace.default(homeDirectory: userHome)

        XCTAssertEqual(workspace.homeDirectory.path, "/Users/example/.agent-server")
        XCTAssertEqual(workspace.agentsDirectory.path, "/Users/example/.agent-server/agents")
        XCTAssertEqual(workspace.environmentFile.path, "/Users/example/.agent-server/.env")
    }

    func testCustomWorkspaceDerivesEveryLocationFromOneRoot() {
        let workspace = AgentServerWorkspace(homeDirectory: URL(fileURLWithPath: "/Volumes/Work/Agent Server"))

        XCTAssertEqual(workspace.agentsDirectory.path, "/Volumes/Work/Agent Server/agents")
        XCTAssertEqual(workspace.environmentFile.path, "/Volumes/Work/Agent Server/.env")
    }

    func testWorkspaceStoreCanSelectAndRestoreTheDefaultWithoutMovingFiles() throws {
        let suiteName = "AgentServerWorkspaceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let userHome = URL(fileURLWithPath: "/Users/example", isDirectory: true)

        AgentServerWorkspaceStore.setHomeDirectory(
            URL(fileURLWithPath: "/Volumes/Agents", isDirectory: true),
            defaults: defaults
        )
        XCTAssertEqual(
            AgentServerWorkspaceStore.current(defaults: defaults, homeDirectory: userHome).homeDirectory.path,
            "/Volumes/Agents"
        )

        AgentServerWorkspaceStore.restoreDefault(defaults: defaults)
        XCTAssertEqual(
            AgentServerWorkspaceStore.current(defaults: defaults, homeDirectory: userHome),
            .default(homeDirectory: userHome)
        )
    }
}
