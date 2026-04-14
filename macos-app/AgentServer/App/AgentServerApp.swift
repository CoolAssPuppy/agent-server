import SwiftUI

@main
struct AgentServerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup("Agent Server", id: "main") {
            MainWindowScene()
        }
        .windowResizability(.contentSize)

        Settings {
            EmptyView()
        }
    }
}

/// Connects the live `StatusMonitor` and `ThemeManager` owned by the
/// `AppDelegate` (menubar owner) to the `MainWindow` SwiftUI scene.
private struct MainWindowScene: View {
    var body: some View {
        if let delegate = NSApp.delegate as? AppDelegate {
            MainWindow(monitor: delegate.monitor)
                .environmentObject(ThemeManager.shared)
        } else {
            // Fallback — should not happen in shipping builds.
            Color.clear
        }
    }
}
