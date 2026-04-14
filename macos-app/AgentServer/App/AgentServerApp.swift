import SwiftUI

/// Menubar-only app. The main window (MainWindow + drawers, per Paper mocks
/// 3E9-1 / 3I6-1 / 3NT-1) is created imperatively by `AppDelegate` when the
/// user clicks the settings gear or an agent row in the popover — NOT by a
/// SwiftUI scene, which would eagerly materialize a window at launch.
///
/// The `Settings { EmptyView() }` scene is the only scene declared; macOS
/// tolerates it as a placeholder without opening a window.
@main
struct AgentServerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
