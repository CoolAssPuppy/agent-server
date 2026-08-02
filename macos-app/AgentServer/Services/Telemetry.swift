import Foundation
import PostHog

/// Anonymous product analytics facade. Every capture site goes through
/// `Telemetry.capture(...)` — no call site imports `PostHog` directly. That is
/// what keeps the providers swappable: add or remove one by editing the
/// `destinations` array in `setup()` and nothing else in the app changes.
///
/// Not to be confused with the A2A run reporting the server calls "telemetry".
/// That reports agent runs to Agent Panel. This reports product usage to a
/// product analytics backend, and the two never share a payload.
///
/// Identity: per-install UUID stored in UserDefaults. The same person across
/// reinstalls or multiple Macs appears as several distinctIds. No PII, no
/// email, no device fingerprint, no agent names, no prompts, no file paths.
///
/// Analytics requires explicit consent in Settings. On opt-out we call `optOut` on every destination
/// so buffered events are dropped and capture stops immediately.
///
/// Config, all from Info.plist. A missing `POSTHOG_API_KEY` silently disables
/// PostHog, so contributor builds without the key baked in never reach the
/// production project.
///
///   POSTHOG_API_KEY     project token, injected from Doppler at build time
///   POSTHOG_HOST        defaults to https://us.i.posthog.com
enum Telemetry {

    // MARK: - Storage keys

    private static let distinctIdKey = "com.strategicnerds.agent-server.distinctId"
    /// Surfaced to the user as "Help improve Agent Server" in Settings.
    static let optInKey = "com.strategicnerds.agent-server.telemetryOptIn"
    /// Mirror of the preference in the workspace `.env`, read by the daemon.
    private static let daemonOptOutKey = "AGENT_SERVER_ANALYTICS_OPT_OUT"

    /// Attached to every event so the macOS app and the bundled CLI daemon stay
    /// separable in the same project. The CLI sends `agent_server_cli`.
    static let source = "agent_server_macos"

    // MARK: - Destination wiring

    /// The live destinations. `nonisolated(unsafe)` is deliberate: capture is
    /// called from any actor context (poll tasks, notification callbacks, UI),
    /// and each concrete destination is thread-safe internally. The only write
    /// happens once in `setup()`; every read after that is safe without a lock.
    nonisolated(unsafe) private static var destinations: [TelemetryDestination] = []

    // MARK: - Public API

    /// Reads the user's current opt-in preference. An unset preference is off.
    static var isOptedIn: Bool {
        let defaults = UserDefaults.standard
        let storedValue = defaults.object(forKey: optInKey) == nil
            ? nil
            : defaults.bool(forKey: optInKey)
        return ProductAnalyticsConsent.isOptedIn(storedValue: storedValue)
    }

    /// Updates the preference and propagates it to every live destination and
    /// to the bundled daemon.
    static func setOptedIn(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: optInKey)
        for destination in destinations {
            deliver(to: destination) {
                if value {
                    try $0.optIn()
                } else {
                    try $0.optOut()
                }
            }
        }
        writeDaemonOptOut(!value)
    }

    /// Mirrors the preference into `~/.agent-server/.env`, which the running
    /// daemon re-reads before every flush.
    ///
    /// Without this an opt-out would only reach the daemon on its next restart,
    /// and a daemon started at login and never touched again would keep sending
    /// for weeks after the user asked it to stop. A failed write is swallowed:
    /// the app's own capture is already off, and a settings toggle must not
    /// throw at the user over a file permission.
    private static func writeDaemonOptOut(_ isOptedOut: Bool) {
        let url = AgentServerWorkspaceStore.current().environmentFile
        guard var pairs = try? EnvFileStore.load(from: url) else { return }
        let pair = EnvPair(key: daemonOptOutKey, value: isOptedOut ? "true" : "false")
        if let index = pairs.firstIndex(where: { $0.key == daemonOptOutKey }) {
            pairs[index] = pair
        } else {
            pairs.append(pair)
        }
        try? EnvFileStore.save(pairs, to: url)
    }

    /// Boots the configured destinations. Called once from AppDelegate.
    ///
    /// Each provider is independent: one missing its key or throwing on setup
    /// does not stop the others. To add a provider — GA4, an internal
    /// collector, anything — conform `TelemetryDestination` and append it here.
    /// That is the only edit; no call site changes.
    static func setup() {
        var configured: [TelemetryDestination] = []
        let id = distinctId()

        if let apiKey = plistString("POSTHOG_API_KEY") {
            let host = plistString("POSTHOG_HOST") ?? "https://us.i.posthog.com"
            configured.append(PostHogDestination(apiKey: apiKey, host: host, distinctId: id))
        }

        for destination in configured {
            deliver(to: destination) { try $0.setup() }
            deliver(to: destination) {
                if isOptedIn {
                    try $0.optIn()
                } else {
                    try $0.optOut()
                }
            }
        }

        destinations = configured
    }

    /// Captures a business-meaningful event. `properties` must never carry PII:
    /// ids, slugs, counts, and enum cases only — no agent names, no prompts, no
    /// file paths, no URLs, no user-entered text. `source` and `app_version`
    /// are attached automatically.
    static func capture(_ event: TelemetryEvent, properties: [String: Any] = [:]) {
        capture(event.rawValue, properties: properties)
    }

    /// String overload for the rare call site that builds a name dynamically.
    /// Prefer the `TelemetryEvent` version so names cannot drift.
    static func capture(_ event: String, properties: [String: Any] = [:]) {
        guard isOptedIn else { return }

        var props = properties
        props["source"] = source
        if let version = plistString("CFBundleShortVersionString") {
            props["app_version"] = version
        }

        for destination in destinations {
            deliver(to: destination) { try $0.capture(event: event, properties: props) }
        }
    }

    /// Sends anything buffered right now.
    ///
    /// Needed exactly once: Sparkle terminates the app immediately after
    /// `update_installed`, and a batched event on a process that is about to
    /// die is an event nobody ever receives.
    static func flush() {
        for destination in destinations {
            deliver(to: destination) { try $0.flush() }
        }
    }

    /// Environment handed to the bundled Node daemon so it can report its own
    /// events under this install's identity.
    ///
    /// The opt-out is not passed here. A daemon can outlive several trips
    /// through Settings, and a value frozen at spawn time could not be revoked;
    /// `setOptedIn` writes it to `~/.agent-server/.env` instead, which the
    /// daemon re-reads on every flush.
    static func childProcessEnvironment() -> [String: String] {
        guard let apiKey = plistString("POSTHOG_API_KEY") else { return [:] }
        var environment = [
            "AGENT_SERVER_ANALYTICS_KEY": apiKey,
            "AGENT_SERVER_ANALYTICS_DISTINCT_ID": distinctId(),
        ]
        if let host = plistString("POSTHOG_HOST") {
            environment["AGENT_SERVER_ANALYTICS_HOST"] = host
        }
        return environment
    }

    /// Reduces an error to a coarse slug safe to send as a property.
    ///
    /// Never the message. Client errors in this app quote server responses,
    /// which quote agent prompts and file paths, and none of that may leave
    /// the machine. A `URLError` contributes its numeric code; anything else
    /// contributes only its type.
    static func reason(for error: Error) -> String {
        if let urlError = error as? URLError {
            return "url_error_\(urlError.code.rawValue)"
        }
        return String(describing: type(of: error))
    }

    // MARK: - Private helpers

    /// Runs one destination's work in isolation. A provider SDK that traps on a
    /// bad payload must not take the rest of the fan-out with it, and analytics
    /// must never surface an error to the user, so failures are swallowed here
    /// deliberately rather than propagated.
    private static func deliver(
        to destination: TelemetryDestination,
        _ work: (TelemetryDestination) throws -> Void
    ) {
        do {
            try work(destination)
        } catch {
            return
        }
    }

    private static func plistString(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty,
              // Reject the unsubstituted XcodeGen build-setting placeholder
              // ("$(POSTHOG_API_KEY)") that survives when the setting is empty.
              !value.hasPrefix("$(")
        else { return nil }
        return value
    }

    private static func distinctId() -> String {
        if let existing = UserDefaults.standard.string(forKey: distinctIdKey) {
            return existing
        }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: distinctIdKey)
        return fresh
    }
}

// MARK: - Destination contract

/// Abstract contract for one analytics provider. To add a provider, conform a
/// new type and append it to `configured` in `Telemetry.setup`.
protocol TelemetryDestination {
    func setup() throws
    func capture(event: String, properties: [String: Any]) throws
    func flush() throws
    func optIn() throws
    func optOut() throws
}

// MARK: - PostHog destination

final class PostHogDestination: TelemetryDestination {
    private let apiKey: String
    private let host: String
    private let distinctId: String

    init(apiKey: String, host: String, distinctId: String) {
        self.apiKey = apiKey
        self.host = host
        self.distinctId = distinctId
    }

    func setup() {
        let config = PostHogConfig(apiKey: apiKey, host: host)
        // Disable PostHog's built-in auto-capture. We only want the explicit
        // business events we fire ourselves; a menu bar app's launch and
        // window churn would drown the handful of events that mean something.
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        PostHogSDK.shared.setup(config)
        PostHogSDK.shared.identify(distinctId)
    }

    func capture(event: String, properties: [String: Any]) {
        PostHogSDK.shared.capture(event, properties: properties)
    }

    func flush() {
        PostHogSDK.shared.flush()
    }

    func optIn() {
        PostHogSDK.shared.optIn()
    }

    func optOut() {
        PostHogSDK.shared.optOut()
    }
}
