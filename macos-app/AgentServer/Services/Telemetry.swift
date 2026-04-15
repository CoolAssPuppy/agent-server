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
    private static var enabled = false

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
        enabled = true
    }

    static func capture(_ event: String, properties: [String: Any] = [:]) {
        guard enabled else { return }
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
