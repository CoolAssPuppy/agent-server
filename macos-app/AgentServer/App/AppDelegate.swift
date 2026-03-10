import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var settingsWindow: NSWindow?
    private let monitor = StatusMonitor()
    private let serverProcess = ServerProcessManager()
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        subscribeToUpdates()

        Task {
            await serverProcess.startIfNeeded()
            monitor.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        monitor.stop()
        serverProcess.stopIfWeStarted()
    }
}

// MARK: - Setup

private extension AppDelegate {
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        guard let button = statusItem?.button else { return }
        button.image = makeMenuBarIcon(active: false)
        button.imagePosition = .imageLeft

        menu = buildMenu()
        statusItem?.menu = menu
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
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.refreshMenu()
                    self?.refreshIcon()
                }
            }
            .store(in: &cancellables)
    }
}

// MARK: - Menu

private extension AppDelegate {
    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        populateMenu(menu)
        return menu
    }

    func refreshMenu() {
        guard let menu else { return }
        menu.removeAllItems()
        populateMenu(menu)
    }

    func populateMenu(_ menu: NSMenu) {
        if !monitor.isServerReachable {
            let offlineItem = NSMenuItem(title: "Server offline", action: nil, keyEquivalent: "")
            offlineItem.isEnabled = false
            menu.addItem(offlineItem)
            menu.addItem(.separator())
        } else {
            let activeRuns = monitor.activeRuns
            if activeRuns.isEmpty {
                let idleItem = NSMenuItem(title: "No active runs", action: nil, keyEquivalent: "")
                idleItem.isEnabled = false
                menu.addItem(idleItem)
            } else {
                for run in activeRuns {
                    let title = "\(run.agentName) (\(run.turnCount) turns)"
                    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                    item.image = circleImage(color: .systemGreen)
                    menu.addItem(item)
                }
            }

            menu.addItem(.separator())

            let scheduledCount = monitor.agents.filter { $0.schedule != nil }.count
            let summaryTitle = "\(scheduledCount) agent\(scheduledCount == 1 ? "" : "s") scheduled"
            let summaryItem = NSMenuItem(title: summaryTitle, action: nil, keyEquivalent: "")
            summaryItem.isEnabled = false
            menu.addItem(summaryItem)
        }

        menu.addItem(.separator())

        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        let quitItem = NSMenuItem(title: "Quit Agent Server", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    func circleImage(color: NSColor) -> NSImage {
        let size = NSSize(width: 8, height: 8)
        let image = NSImage(size: size, flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect).fill()
            return true
        }
        return image
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
    @objc func showSettings() {
        NSApp.setActivationPolicy(.regular)

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            NSApp.activate(ignoringOtherApps: true)

            if let existingWindow = settingsWindow {
                existingWindow.makeKeyAndOrderFront(nil)
                return
            }

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 600, height: 450),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.contentView = NSHostingView(rootView: SettingsView(monitor: monitor))
            window.title = "Agent Server"
            window.isReleasedWhenClosed = false
            window.center()
            window.makeKeyAndOrderFront(nil)
            window.delegate = self

            settingsWindow = window
        }
    }

    @objc func quitApp() {
        NSApp.terminate(nil)
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
