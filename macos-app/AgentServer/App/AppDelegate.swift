import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var settingsWindow: NSWindow?
    private var aboutWindow: NSWindow?
    let monitor = StatusMonitor()
    private let serverProcess = ServerProcessManager()
    private let notificationManager = NotificationManager()
    private let eventKitPermissionManager = EventKitPermissionManager()
    private let updaterManager = UpdaterManager.shared
    private let themeManager = ThemeManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var eventMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupMainMenu()
        setupStatusItem()
        setupPopover()
        subscribeToUpdates()

        notificationManager.requestAuthorization()
        eventKitPermissionManager.requestAccessIfNeeded()
        monitor.setServerProcess(serverProcess)
        monitor.setNotificationManager(notificationManager)

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
    func setupMainMenu() {
        let mainMenu = NSMenu()

        // App menu (titled by macOS with the process name)
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()

        let about = NSMenuItem(
            title: "About Agent Server",
            action: #selector(showAbout),
            keyEquivalent: ""
        )
        about.target = self
        appMenu.addItem(about)
        appMenu.addItem(.separator())

        let checkUpdates = NSMenuItem(
            title: "Check for Updates\u{2026}",
            action: #selector(checkForUpdates),
            keyEquivalent: ""
        )
        checkUpdates.target = self
        appMenu.addItem(checkUpdates)
        appMenu.addItem(.separator())

        let settings = NSMenuItem(
            title: "Settings\u{2026}",
            action: #selector(showSettings as () -> Void),
            keyEquivalent: ","
        )
        settings.target = self
        appMenu.addItem(settings)
        appMenu.addItem(.separator())

        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu()
        NSApp.servicesMenu = servicesMenu
        services.submenu = servicesMenu
        appMenu.addItem(services)
        appMenu.addItem(.separator())

        appMenu.addItem(NSMenuItem(
            title: "Hide Agent Server",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        ))
        let hideOthers = NSMenuItem(
            title: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(
            title: "Show All",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        ))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(
            title: "Quit Agent Server",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))

        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit menu — standard text editing shortcuts
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // Window menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        guard let button = statusItem?.button else { return }
        button.image = makeMenuBarIcon(active: false)
        button.action = #selector(statusItemClicked)
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc func statusItemClicked() {
        guard let event = NSApp.currentEvent else { togglePopover(); return }
        if event.type == .rightMouseUp {
            showStatusItemMenu()
        } else {
            togglePopover()
        }
    }

    func showStatusItemMenu() {
        guard let statusItem else { return }
        let menu = NSMenu()
        let check = NSMenuItem(title: "Check for Updates\u{2026}", action: #selector(checkForUpdates), keyEquivalent: "")
        check.target = self
        menu.addItem(check)
        menu.addItem(.separator())
        let settings = NSMenuItem(title: "Settings\u{2026}", action: #selector(showSettings as () -> Void), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Agent Server", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
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

    @objc func checkForUpdates() {
        updaterManager.checkForUpdates()
    }

    @objc func showAbout() {
        NSApp.activate(ignoringOtherApps: true)

        if let existingWindow = aboutWindow {
            existingWindow.makeKeyAndOrderFront(nil)
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 360),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "About Agent Server"
        window.contentView = NSHostingView(rootView: AboutView())
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.delegate = self

        aboutWindow = window
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
        guard let window = notification.object as? NSWindow else { return }

        if window == aboutWindow {
            aboutWindow = nil
            return
        }

        if window == settingsWindow {
            settingsWindow = nil
            NSApp.setActivationPolicy(.accessory)
        }
    }
}
