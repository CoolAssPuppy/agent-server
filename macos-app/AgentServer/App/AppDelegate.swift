import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var aboutWindow: NSWindow?
    private var mainWindow: NSWindow?
    let monitor = StatusMonitor()
    private let serverProcess = ServerProcessManager()
    private let notificationManager = NotificationManager()
    private let updaterManager = UpdaterManager.shared
    private let themeManager = ThemeManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var eventMonitor: Any?
    private var isTerminationPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
#if DEBUG
        if let scenario = UITestScenario.current {
            mainWindow = UITestScenarioWindow.makeWindow(for: scenario)
            return
        }
#endif

        // Agent Server is a menubar-only app. The main window (MainWindow +
        // drawers) is created imperatively when the user clicks the settings
        // gear or an agent row in the popover — see openMainWindow(route:).
        NSApp.setActivationPolicy(.accessory)
        Telemetry.setup()
        Telemetry.capture("app_launched")
        setupStatusItem()
        setupPopover()
        subscribeToUpdates()

        notificationManager.requestAuthorization()
        monitor.setServerProcess(serverProcess)
        monitor.setNotificationManager(notificationManager)

        Task {
            await serverProcess.startIfNeeded()
            monitor.start()
        }

        // Dev affordance: auto-open a screen on launch so UI can be inspected
        // and screenshotted without driving the menu bar. Never fires in normal
        // use (no env var set).
        if let route = ProcessInfo.processInfo.environment["AGENT_SERVER_UI_AUTOOPEN"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                switch route {
                case "settings": self?.openMainWindow(route: .settings)
                case "connections": self?.openMainWindow(route: .connections)
                case let r where r.hasPrefix("detail:"):
                    self?.openMainWindow(route: .detail(agentId: String(r.dropFirst("detail:".count))))
                default: self?.openMainWindow()
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        monitor.stop()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminationPending else { return .terminateLater }
        isTerminationPending = true
        monitor.stop()

        Task {
            await serverProcess.stopIfWeStarted()
            if let error = serverProcess.lastError {
                let alert = NSAlert()
                alert.alertStyle = .warning
                alert.messageText = "Agent Server could not finish shutting down"
                alert.informativeText = error.localizedDescription
                alert.addButton(withTitle: "Quit Anyway")
                alert.runModal()
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.installMainMenuIfNeeded()
        }
    }
}

// MARK: - Setup

private extension AppDelegate {
    func installMainMenuIfNeeded() {
        guard let mainMenu = NSApp.mainMenu else {
            setupMainMenu()
            return
        }
        let menuActions = mainMenu.items.map { item in
            item.submenu?.items.compactMap { $0.action.map(NSStringFromSelector) } ?? []
        }
        let fileMenu = zip(mainMenu.items, menuActions)
            .first(where: { ApplicationMenuPolicy.isFileMenu(actionNames: $0.1) })?.0.submenu
        let editMenu = zip(mainMenu.items, menuActions)
            .first(where: { ApplicationMenuPolicy.isEditMenu(actionNames: $0.1) })?.0.submenu
        if !menuActions.joined().contains(NSStringFromSelector(#selector(showNewAgent))) {
            if let fileMenu {
                fileMenu.insertItem(makeNewAgentMenuItem(), at: 0)
            } else {
                mainMenu.insertItem(makeFileMenuItem(), at: min(1, mainMenu.items.count))
            }
        }
        if let editMenu {
            StandardEditMenu.repair(editMenu)
        } else {
            let item = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
            item.submenu = StandardEditMenu.make()
            mainMenu.insertItem(item, at: min(2, mainMenu.items.count))
        }
    }

    func makeNewAgentMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "New Agent", action: #selector(showNewAgent), keyEquivalent: "n")
        item.target = self
        return item
    }

    func makeFileMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let menu = NSMenu(title: "File")
        menu.addItem(makeNewAgentMenuItem())
        item.submenu = menu
        return item
    }

    func setupMainMenu() {
        let mainMenu = NSMenu()

        // App menu (titled by macOS with the process name)
        let appMenuItem = NSMenuItem(title: "Agent Server", action: nil, keyEquivalent: "")
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

        mainMenu.addItem(makeFileMenuItem())

        // Edit menu — standard text editing shortcuts
        let editMenuItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editMenuItem.submenu = StandardEditMenu.make()
        mainMenu.addItem(editMenuItem)

        // Window menu
        let windowMenuItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
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
            onOpenHome: { [weak self] in self?.openMainWindow() },
            onOpenSettings: { [weak self] in self?.openMainWindow(route: .settings) },
            onOpenAgent: { [weak self] agentId in self?.openMainWindow(route: .detail(agentId: agentId)) },
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
    /// Opens the main window on a specific agent's detail drawer, or on the
    /// settings drawer when no agent is given. This is the single deep-link
    /// path into the app (popover rows, notifications).
    func openSettingsForAgent(_ agentId: String?) {
        popover.performClose(nil)
        if let agentId {
            openMainWindow(route: .detail(agentId: agentId))
        } else {
            openMainWindow(route: .settings)
        }
    }

    /// Brings the main window to front with the requested drawer (settings or
    /// a specific agent detail) open. Called from the popover's gear button
    /// and agent row taps. Creates the NSWindow lazily on first use.
    ///
    /// Animation sequence on open:
    ///   1. NSWindow fades in (~150ms) from alpha 0 -> 1.
    ///   2. After the window is on screen, `DrawerRouter.shared.routeTo(_:)`
    ///      is called inside `withAnimation(.easeOut(...))` so SwiftUI sees
    ///      the nil -> open transition and plays the drawer's .move(edge:).
    func openMainWindow(route: Drawer? = nil) {
        popover.performClose(nil)

        Task { @MainActor in
            // Give the popover time to collapse before activating the app.
            try? await Task.sleep(for: .milliseconds(60))

            // Stay as .accessory permanently — Agent Server must never appear
            // in the Dock or in Cmd-Tab. .accessory apps can still present
            // windows and make them key; they just don't get a Dock icon.
            NSApp.activate(ignoringOtherApps: true)

            if let window = mainWindow {
                fadeIn(window: window)
                if let route { scheduleDrawerOpen(route: route) }
                else { DrawerRouter.shared.close() }
                return
            }

            // Ensure the router is closed so the drawer has a nil -> open
            // transition SwiftUI can animate on first appear.
            DrawerRouter.shared.close()

            let content = MainWindow(monitor: monitor)
                .environmentObject(themeManager)

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1280, height: 920),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            window.title = "Agent Server"
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isReleasedWhenClosed = false
            window.animationBehavior = .documentWindow
            // Enforce a minimum size so both the sidebar footer and the main
            // pane footer always have room to render. No identifier + no
            // frame autosave — we want a predictable size on every launch
            // rather than macOS restoring a prior small frame that clipped
            // the footer off.
            window.minSize = NSSize(width: 1080, height: 720)
            window.setContentSize(NSSize(width: 1280, height: 920))
            window.center()
            window.delegate = self
            window.contentViewController = NSHostingController(rootView: content)
            mainWindow = window

            fadeIn(window: window)
            if let route { scheduleDrawerOpen(route: route) }
        }
    }

    /// Fades the window from alphaValue 0 to 1 over ~150ms so the app-open
    /// feels less abrupt than a synchronous `makeKeyAndOrderFront`.
    private func fadeIn(window: NSWindow) {
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().alphaValue = 1
        }
    }

    /// Stages the requested route as a `pending` value on the shared router.
    /// `MainWindow.onAppear` commits it inside its own `withAnimation` block
    /// so the drawer's `.move(edge:)` transition plays reliably on insert.
    /// Driving the animation from AppDelegate didn't work because
    /// `withAnimation` called outside the NSHostingController's SwiftUI
    /// transaction is not always honored.
    private func scheduleDrawerOpen(route: Drawer) {
        DrawerRouter.shared.pending = route
    }

    @objc func showSettings() {
        // Single path: reveal the main window with the settings drawer down.
        openMainWindow(route: .settings)
    }

    @objc func showNewAgent() {
        openMainWindow(route: .creation())
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

        if window == mainWindow {
            mainWindow = nil
            DrawerRouter.shared.close()
        }
    }
}
