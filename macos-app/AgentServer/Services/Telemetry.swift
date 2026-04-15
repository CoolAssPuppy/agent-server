import Foundation
import PostHog

/// Anonymous product analytics for Agent Server. Uses a per-install UUID held
/// in UserDefaults as the distinctId, so one person across reinstalls/multiple
/// Macs appears as multiple users. No PII is ever captured.
///
/// The write-key lives in Info.plist under POSTHOG_API_KEY. Contributors who
/// clone the repo won't have a key (Info.plist is gitignored); in that case
/// `setup()` quietly disables capture so dev builds don't spam the project.
enum Telemetry {
    private static let distinctIdKey = "com.strategicnerds.agent-server.distinctId"
    /// Surfaced to the user as "Help improve Agent Server" in Settings. Opt-out,
    /// defaults to ON. Nil in UserDefaults means "never set" → treat as opted in.
    static let optInKey = "com.strategicnerds.agent-server.telemetryOptIn"
    private static var configured = false

    /// Reads the user's current opt-in preference. Defaults to true when unset.
    static var isOptedIn: Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: optInKey) == nil {
            return true
        }
        return defaults.bool(forKey: optInKey)
    }

    /// Updates the preference. When turning off we also call PostHog's `optOut`
    /// so the SDK drops any buffered events and stops future captures.
    static func setOptedIn(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: optInKey)
        guard configured else { return }
        if value {
            PostHogSDK.shared.optIn()
        } else {
            PostHogSDK.shared.optOut()
        }
    }

    static func setup() {
        guard
            let apiKey = Bundle.main.object(forInfoDictionaryKey: "POSTHOG_API_KEY") as? String,
            !apiKey.isEmpty
        else {
            return
        }
        let host = (Bundle.main.object(forInfoDictionaryKey: "POSTHOG_HOST") as? String)
            ?? "https://us.i.posthog.com"

        let config = PostHogConfig(apiKey: apiKey, host: host)
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        PostHogSDK.shared.setup(config)
        PostHogSDK.shared.identify(distinctId())
        configured = true

        // Honor the current user preference on every launch. Users who opted
        // out previously stay opted out until they flip the switch back.
        if isOptedIn {
            PostHogSDK.shared.optIn()
        } else {
            PostHogSDK.shared.optOut()
        }
    }

    static func capture(_ event: String, properties: [String: Any] = [:]) {
        guard configured, isOptedIn else { return }
        var props = properties
        props["source"] = "agent_server_macos"
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            props["app_version"] = version
        }
        PostHogSDK.shared.capture(event, properties: props)
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
