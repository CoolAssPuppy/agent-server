import ServiceManagement
import SwiftUI

@MainActor
final class LaunchAtLoginManager: ObservableObject {
    static let shared = LaunchAtLoginManager()

    @Published var isEnabled: Bool {
        didSet {
            if isEnabled {
                enable()
            } else {
                disable()
            }
        }
    }

    private init() {
        isEnabled = SMAppService.mainApp.status == .enabled
    }

    private func enable() {
        do {
            try SMAppService.mainApp.register()
        } catch {
            isEnabled = false
        }
    }

    private func disable() {
        do {
            try SMAppService.mainApp.unregister()
        } catch {
            isEnabled = SMAppService.mainApp.status == .enabled
        }
    }

    func refresh() {
        isEnabled = SMAppService.mainApp.status == .enabled
    }
}
