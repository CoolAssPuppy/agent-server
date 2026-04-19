import AppKit
import AVFoundation
import Foundation
import UserNotifications

@MainActor
final class NotificationManager {
    private let center = UNUserNotificationCenter.current()
    let preferences: NotificationPreferences

    private var chimePlayer: AVAudioPlayer?

    init(preferences: NotificationPreferences = .shared) {
        self.preferences = preferences
        observeAppActivation()
        chimePlayer = Self.makeChimePlayer()
    }

    /// Build an `AVAudioPlayer` for the bundled chime. We use our own
    /// audio player because macOS NotificationCenter's `UNNotificationSound`
    /// playback is unreliable for custom sounds on Sonoma/Sequoia — usernoted
    /// logs `Playing notification sound` but the audio often doesn't reach
    /// the speaker. Playing via `AVAudioPlayer` from our own process gives
    /// us deterministic behavior and lets us still respect the user's
    /// preferences via `shouldPost(_:)`.
    private static func makeChimePlayer() -> AVAudioPlayer? {
        guard let url = Bundle.main.url(forResource: "agent-server-notification", withExtension: "aiff") else {
            return nil
        }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            return player
        } catch {
            NSLog("[notifications] Could not prepare chime player: %@", String(describing: error))
            return nil
        }
    }

/// Request notification permission. Behavior:
    /// - `.notDetermined`: triggers the macOS prompt (one-time, on first launch).
    ///   For menu-bar (.accessory) apps the prompt can land behind the active
    ///   window, so we activate the app first to make sure the user sees it.
    /// - `.denied`: log a hint so the user knows where to flip it on.
    /// - `.authorized` / `.provisional`: nothing to do; macOS handles delivery.
    ///
    /// Note: we do NOT cache an `isAuthorized` flag. `UNUserNotificationCenter.add`
    /// silently drops notifications when permission is missing, and the user can
    /// flip the System Settings toggle at any time. Re-querying on every post is
    /// cheap, and avoiding stale local cache fixes the case where the user
    /// granted after launch (which the old caching code missed).
    func requestAuthorization() {
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .notDetermined:
                Task { @MainActor in
                    NSApp.activate(ignoringOtherApps: true)
                    self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                        if let error {
                            print("[notifications] Authorization request failed: \(error.localizedDescription)")
                        } else if !granted {
                            print("[notifications] User declined notification permission. Enable in System Settings > Notifications > Agent Server.")
                        }
                    }
                }
            case .denied:
                print("[notifications] Permission denied. Enable in System Settings > Notifications > Agent Server.")
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
            // No-op refresh: the next post() will pick up whatever System
            // Settings says. This observer is here so we can extend later
            // (e.g. to update a Settings UI badge) without changing call sites.
            _ = self
        }
    }

    // MARK: Agent output (tier 2)

    func notifyRunCompleted(agentName: String, summary: String?) {
        let body = summary.flatMap { trimmed($0) } ?? "Run completed"
        post(
            title: agentName,
            body: body,
            category: .agentOutput,
            identifier: "run-completed-\(UUID().uuidString)"
        )
    }

    func notifyRunFailed(agentName: String, error: String?) {
        let body = error.flatMap { trimmed($0) } ?? "Run failed"
        post(
            title: "\(agentName) failed",
            body: body,
            category: .agentOutput,
            identifier: "run-failed-\(UUID().uuidString)"
        )
    }

    // MARK: System events (tier 1)

    func notifyRunTimedOut(agentName: String) {
        post(
            title: "\(agentName) timed out",
            body: "The run exceeded its wall-clock timeout and was aborted.",
            category: .systemEvent,
            identifier: "run-timeout-\(UUID().uuidString)"
        )
    }

    func notifyMcpNeedsAuth(serverNames: [String]) {
        guard !serverNames.isEmpty else { return }
        let list = serverNames.joined(separator: ", ")
        post(
            title: "Reconnect required",
            body: "These MCP servers need re-auth in Claude Code: \(list)",
            category: .systemEvent,
            identifier: "mcp-auth-\(UUID().uuidString)"
        )
    }

    func notifyServerRestarted() {
        post(
            title: "Agent Server restarted",
            body: "Previously running agents were released.",
            category: .systemEvent,
            identifier: "server-restart-\(UUID().uuidString)"
        )
    }

    // MARK: Internal

    private func post(
        title: String,
        body: String,
        category: NotificationCategory,
        identifier: String
    ) {
        guard preferences.shouldPost(category) else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // Silent notification — we play the chime ourselves via AVAudioPlayer
        // below. macOS `UNNotificationSound(named:)` is unreliable for custom
        // sounds; this avoids fighting it.
        content.sound = nil

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { error in
            if let error {
                NSLog("[notifications] Delivery failed for %@: %@", identifier, error.localizedDescription)
            }
        }

        playChime()
    }

    /// Play the custom chime out-of-band from the notification banner. macOS
    /// respects our app's notification sound setting automatically because the
    /// `shouldPost(_:)` check above already gates us on the user's in-app
    /// preference. We intentionally do NOT check
    /// `UNUserNotificationCenter.current().getNotificationSettings().soundSetting`
    /// — users can disable our tier-2 toggle if they want silence.
    private func playChime() {
        guard let player = chimePlayer else { return }
        if player.isPlaying {
            player.currentTime = 0
        }
        player.play()
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
