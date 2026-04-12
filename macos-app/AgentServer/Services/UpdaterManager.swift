import AppKit
import Combine
import Sparkle

@MainActor
final class UpdaterManager: NSObject, ObservableObject, SPUUpdaterDelegate {
    static let shared = UpdaterManager()

    @Published private(set) var canCheckForUpdates: Bool = false
    @Published var automaticallyChecksForUpdates: Bool = false {
        didSet {
            controller?.updater.automaticallyChecksForUpdates = automaticallyChecksForUpdates
        }
    }

    private var controller: SPUStandardUpdaterController!
    private var cancellable: AnyCancellable?

    override init() {
        super.init()
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        self.controller = controller
        self.automaticallyChecksForUpdates = controller.updater.automaticallyChecksForUpdates

        cancellable = controller.updater
            .publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] value in
                self?.canCheckForUpdates = value
            }
    }

    func checkForUpdates() {
        controller.checkForUpdates(nil)
    }

    // MARK: - SPUUpdaterDelegate

    // Sparkle calls this right before terminating+relaunching the app after
    // installing an update. Any open sheets block NSApp.terminate and cause
    // the system beep ("pop"), so we dismiss them here.
    nonisolated func updaterWillRelaunchApplication(_ updater: SPUUpdater) {
        Task { @MainActor in
            for window in NSApp.windows {
                for sheet in window.sheets {
                    window.endSheet(sheet)
                }
            }
        }
    }
}
