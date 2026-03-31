import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var settingsWindow: NSWindow?
    private let monitor = StatusMonitor()
    private let serverProcess = ServerProcessManager()
    private let themeManager = ThemeManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var eventMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        setupPopover()
        subscribeToUpdates()

        monitor.setServerProcess(serverProcess)

        Task {
            await serverProcess.startIfNeeded()
            monitor.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        monitor.stop()
        serverProcess.stopIfWeStarted()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

// MARK: - Setup

private extension AppDelegate {
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        guard let button = statusItem?.button else { return }
        button.image = makeMenuBarIcon(active: false)
        button.action = #selector(togglePopover)
        button.target = self
    }

    static let popoverSize = NSSize(width: 360, height: 440)

    func setupPopover() {
        let popoverView = MenuBarPopover(
            monitor: monitor,
            onOpenSettings: { [weak self] agentId in self?.openSettingsForAgent(agentId) },
            onQuit: { NSApp.terminate(nil) }
        )
        .environmentObject(themeManager)

        let hostingView = NSHostingView(rootView: popoverView)
        hostingView.frame = NSRect(origin: .zero, size: Self.popoverSize)

        let controller = NSViewController()
        controller.view = hostingView

        popover.contentSize = Self.popoverSize
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        popover.contentViewController = controller
    }

    func makeMenuBarIcon(active: Bool) -> NSImage? {
        let name = active ? "MenuBarIconActive" : "MenuBarIcon"
        guard let image = NSImage(named: name) else { return nil }
        image.size = NSSize(width: 22, height: 22)
        image.isTemplate = !active
        return image
    }

    func subscribeToUpdates() {
        monitor.objectWillChange
            .debounce(for: .milliseconds(50), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                self?.refreshIcon()
            }
            .store(in: &cancellables)
    }
}

// MARK: - Popover

private extension AppDelegate {
    @objc func togglePopover() {
        guard let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            startEventMonitor()
        }
    }

    func startEventMonitor() {
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.popover.performClose(nil)
        }
    }
}

// MARK: - Icon

private extension AppDelegate {
    func refreshIcon() {
        guard let button = statusItem?.button else { return }
        let hasActiveRuns = !monitor.activeRuns.isEmpty && monitor.isServerReachable
        button.image = makeMenuBarIcon(active: hasActiveRuns)
    }
}

// MARK: - Actions

extension AppDelegate {
    func openSettingsForAgent(_ agentId: String?) {
        popover.performClose(nil)
        showSettings(deepLinkAgentId: agentId)
    }

    @objc func showSettings() {
        showSettings(deepLinkAgentId: nil)
    }

    private func showSettings(deepLinkAgentId: String?) {
        NSApp.setActivationPolicy(.regular)

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            NSApp.activate(ignoringOtherApps: true)

            if let existingWindow = settingsWindow {
                existingWindow.makeKeyAndOrderFront(nil)
                if let deepLinkAgentId {
                    monitor.deepLinkAgentId = deepLinkAgentId
                }
                return
            }

            let settingsView = SettingsView(monitor: monitor)
                .environmentObject(themeManager)

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 980, height: 600),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.contentView = NSHostingView(rootView: settingsView)
            window.title = "Agent Server"
            window.isReleasedWhenClosed = false
            window.center()
            window.makeKeyAndOrderFront(nil)
            window.delegate = self

            settingsWindow = window

            if let deepLinkAgentId {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    self.monitor.deepLinkAgentId = deepLinkAgentId
                }
            }
        }
    }

    @objc func cleanupStaleRuns() {
        monitor.cleanupStaleRuns()
    }
}

// MARK: - NSPopoverDelegate

extension AppDelegate {
    func popoverDidClose(_ notification: Notification) {
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
            eventMonitor = nil
        }
    }
}

// MARK: - NSWindowDelegate

extension AppDelegate: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow,
              window == settingsWindow else { return }
        settingsWindow = nil
        NSApp.setActivationPolicy(.accessory)
    }
}
