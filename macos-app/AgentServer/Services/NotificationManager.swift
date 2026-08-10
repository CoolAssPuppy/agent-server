import AppKit
import AVFoundation
import Foundation
import UserNotifications

@MainActor
final class NotificationManager {
    private let center = UNUserNotificationCenter.current()
    private let preferences: NotificationPreferences
    private let chimePlayers: [Chime: AVAudioPlayer]
    private var cachedSettings: CachedSettings = .unknown

    init(preferences: NotificationPreferences = .shared) {
        self.preferences = preferences
        self.chimePlayers = Self.makeChimePlayers()
        observeAppActivation()
        refreshSettings()
    }

    enum Chime: String, CaseIterable {
        case info    = "agent-server-notification"
        case success = "agent-server-success"
        case failure = "agent-server-failure"
    }

    /// Cached snapshot of OS-level notification settings. Refreshed at init
    /// and on `didBecomeActive` so we don't hit `getNotificationSettings`
    /// on every notification post.
    private struct CachedSettings {
        let canDeliver: Bool
        let soundEnabled: Bool

        static let unknown = CachedSettings(canDeliver: true, soundEnabled: true)
    }

    func requestAuthorization() {
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .notDetermined:
                Task { @MainActor in
                    NSApp.activate(ignoringOtherApps: true)
                    self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                        if let error {
                            NSLog("[notifications] Authorization request failed: %@", error.localizedDescription)
                        } else if !granted {
                            NSLog("[notifications] User declined notification permission. Enable in System Settings > Notifications > Agent Server.")
                        }
                        Task { @MainActor in self.refreshSettings() }
                    }
                }
            case .denied:
                NSLog("[notifications] Permission denied. Enable in System Settings > Notifications > Agent Server.")
            case .authorized, .provisional, .ephemeral:
                break
            @unknown default:
                break
            }
        }
    }

    private func observeAppActivation() {
        NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshSettings() }
        }
    }

    private func refreshSettings() {
        center.getNotificationSettings { [weak self] settings in
            let snapshot = CachedSettings(
                canDeliver: Self.canDeliver(settings),
                soundEnabled: settings.soundSetting == .enabled
            )
            Task { @MainActor in self?.cachedSettings = snapshot }
        }
    }

    // MARK: Agent output (tier 2)

    func notifyRunCompleted(agentName: String, summary: String?) {
        let body = summary.flatMap { trimmed($0) } ?? "Run completed"
        post(
            title: agentName,
            body: body,
            category: .agentOutput,
            chime: .success,
            identifier: "run-completed-\(UUID().uuidString)"
        )
    }

    func notifyRunFailed(agentName: String, error: String?) {
        let body = error.flatMap { trimmed($0) } ?? "Run failed"
        post(
            title: "\(agentName) failed",
            body: body,
            category: .agentOutput,
            chime: .failure,
            identifier: "run-failed-\(UUID().uuidString)"
        )
    }

    func notifyRunTimedOut(agentName: String) {
        post(
            title: "\(agentName) timed out",
            body: "The run exceeded its wall-clock timeout and was aborted.",
            category: .agentOutput,
            chime: .failure,
            identifier: "run-timeout-\(UUID().uuidString)"
        )
    }

    // MARK: System events (tier 1)

    /// An agent's scheduled run was withheld pending a security review. Not a
    /// failure: nothing broke, and the failure chime at 3am for it taught one
    /// person to distrust the word "failed".
    func notifyRunNeedsReview(agentName: String) {
        post(
            title: "\(agentName) is waiting on you",
            body: "It will not run on its schedule until you approve its security review.",
            category: .systemEvent,
            chime: .info,
            identifier: "run-needs-review-\(UUID().uuidString)"
        )
    }

    /// Runs have stopped reaching Agent Panel. Sent once per outage, when the
    /// state transitions to failing; the ongoing condition lives in Settings.
    func notifyPanelReportingFailing(reason: String?) {
        let detail = reason.flatMap { $0.isEmpty ? nil : " (\($0))" } ?? ""
        post(
            title: "Agent Panel is not hearing from this Mac",
            body: "Runs are happening but are not reaching Panel\(detail). Open Settings for details.",
            category: .systemEvent,
            chime: .info,
            identifier: "panel-reporting-\(UUID().uuidString)"
        )
    }

    func notifyMcpNeedsAuth(serverNames: [String]) {
        guard !serverNames.isEmpty else { return }
        let list = serverNames.joined(separator: ", ")
        post(
            title: "Reconnect required",
            body: "These MCP servers need re-auth in Claude Code: \(list)",
            category: .systemEvent,
            chime: .info,
            identifier: "mcp-auth-\(UUID().uuidString)"
        )
    }

    func notifyServerRestarted() {
        post(
            title: "Agent Server restarted",
            body: "Previously running agents were released.",
            category: .systemEvent,
            chime: .info,
            identifier: "server-restart-\(UUID().uuidString)"
        )
    }

    // MARK: Internal

    private func post(
        title: String,
        body: String,
        category: NotificationCategory,
        chime: Chime,
        identifier: String
    ) {
        guard preferences.shouldPost(category) else { return }

        // Silent banner — we play the chime ourselves via AVAudioPlayer
        // because UNNotificationSound's custom-sound path is unreliable on
        // macOS Sonoma+ (usernoted logs the sound play but audio never
        // reaches the speaker).
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = nil

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { error in
            if let error {
                NSLog("[notifications] Delivery failed for %@: %@", identifier, error.localizedDescription)
            }
        }

        if cachedSettings.canDeliver && cachedSettings.soundEnabled {
            play(chime)
        }
    }

    private static func canDeliver(_ settings: UNNotificationSettings) -> Bool {
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined, .denied: return false
        @unknown default: return false
        }
    }

    private func play(_ chime: Chime) {
        guard let player = chimePlayers[chime] else { return }
        if player.isPlaying {
            player.currentTime = 0
        }
        player.play()
    }

    private static func makeChimePlayers() -> [Chime: AVAudioPlayer] {
        var out: [Chime: AVAudioPlayer] = [:]
        for chime in Chime.allCases {
            guard let url = Bundle.main.url(forResource: chime.rawValue, withExtension: "aiff") else {
                NSLog("[notifications] Bundled chime missing: %@.aiff", chime.rawValue)
                continue
            }
            do {
                let player = try AVAudioPlayer(contentsOf: url)
                player.prepareToPlay()
                out[chime] = player
            } catch {
                NSLog("[notifications] Could not prepare chime %@: %@", chime.rawValue, String(describing: error))
            }
        }
        return out
    }

    private func trimmed(_ text: String) -> String? {
        let stripped = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.isEmpty { return nil }

        let maxLength = 240
        if stripped.count <= maxLength { return stripped }

        let endIndex = stripped.index(stripped.startIndex, offsetBy: maxLength)
        return String(stripped[..<endIndex]) + "..."
    }
}
