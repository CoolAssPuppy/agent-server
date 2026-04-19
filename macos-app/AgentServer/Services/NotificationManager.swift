import AppKit
import AVFoundation
import Foundation
import UserNotifications

@MainActor
final class NotificationManager {
    private let center = UNUserNotificationCenter.current()
    let preferences: NotificationPreferences
    private let chimePlayers: [Chime: AVAudioPlayer]

    init(preferences: NotificationPreferences = .shared) {
        self.preferences = preferences
        self.chimePlayers = Self.makeChimePlayers()
        observeAppActivation()
    }

    /// Which audio to play alongside a notification banner.
    ///
    /// Three chimes cover every call site:
    /// - `.info` for tier-1 system events (MCP re-auth, server restart).
    ///   Uses the generic `agent-server-notification.aiff`.
    /// - `.success` for completed runs. Uses `agent-server-success.aiff`.
    /// - `.failure` for failed or timed-out runs. Uses
    ///   `agent-server-failure.aiff`.
    enum Chime: String, CaseIterable {
        case info    = "agent-server-notification"
        case success = "agent-server-success"
        case failure = "agent-server-failure"
    }

    /// Request notification permission. Behavior:
    /// - `.notDetermined`: triggers the macOS prompt (one-time, on first launch).
    ///   For menu-bar (.accessory) apps the prompt can land behind the active
    ///   window, so we activate the app first to make sure the user sees it.
    /// - `.denied`: log a hint so the user knows where to flip it on.
    /// - `.authorized` / `.provisional`: nothing to do; macOS handles delivery.
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
            _ = self
        }
    }

    // MARK: Agent output (tier 2)

    /// Successful run completion. Tier 2. Uses the success chime.
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

    /// Run failed (non-timeout). Tier 2. Uses the failure chime.
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

    /// Run hit the wall-clock timeout. Tier 2 (treated as agent output, same
    /// gating as `notifyRunFailed`). Uses the failure chime.
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

    /// One or more MCP servers need re-authentication. Tier 1.
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

    /// The agent server process restarted (detected via `/health` delta). Tier 1.
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

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // Silent banner — we play the chime ourselves via AVAudioPlayer so we
        // can pick per-event sounds reliably. macOS's `UNNotificationSound`
        // custom-sound path is unreliable on Sonoma+ (see prior commit).
        content.sound = nil

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { error in
            if let error {
                NSLog("[notifications] Delivery failed for %@: %@", identifier, error.localizedDescription)
            }
        }

        // Respect the OS-level sound setting. If the user has disabled sound
        // for Agent Server in System Settings > Notifications, we stay silent
        // even though the banner still shows. This mirrors what `UNUserNotificationCenter`
        // would do if we had set `content.sound`.
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            guard Self.shouldDeliver(settings) else { return }
            guard settings.soundSetting == .enabled else { return }
            Task { @MainActor in
                self.play(chime)
            }
        }
    }

    /// Whether the OS is willing to deliver notifications for us at all.
    /// Covers the common authorized states; returns false for `.denied` and
    /// any future enum case we don't explicitly recognize.
    private static func shouldDeliver(_ settings: UNNotificationSettings) -> Bool {
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

    /// Prepare an `AVAudioPlayer` for each chime at init. The players are
    /// kept alive for the app's lifetime and reused on every post. Pre-loading
    /// avoids a first-play lag.
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
