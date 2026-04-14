import SwiftUI

@main
struct AgentServerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup("Agent Server", id: "main") {
            MainWindow(monitor: appDelegate.monitor)
                .environmentObject(ThemeManager.shared)
        }
        .windowResizability(.contentSize)

        Settings {
            EmptyView()
        }
    }
}
