import Foundation

/// Bucket for each kind of notification the app can emit. Gate checks in
/// `NotificationPreferences.shouldPost(_:)` route these to user-visible
/// toggles so the user can opt in or out independently.
public enum NotificationCategory: Equatable, Sendable {
    /// Things Agent Server itself encounters: MCP needing re-auth, run
    /// timeouts, server restart. Gated by the master "Enable notifications"
    /// toggle.
    case systemEvent
    /// Per-run lifecycle events (completed, failed). Gated by the
    /// "Also notify for agent output" toggle, which itself requires the
    /// master toggle to be on.
    case agentOutput
}

/// User-facing notification preferences backed by `UserDefaults`.
///
/// Defaults: both toggles start ON so users upgrading from 2.1.x keep
/// receiving notifications they already expect. Users can turn either
/// off in Settings.
public final class NotificationPreferences: ObservableObject {
    /// Shared instance for the running app. Tests construct their own
    /// isolated instances via `init(defaults:)` so singleton state does
    /// not leak across test cases.
    public static let shared = NotificationPreferences()

    public static let enabledKey = "notifications.enabled"
    public static let includeAgentOutputKey = "notifications.includeAgentOutput"

    @Published public var enabled: Bool {
        didSet { defaults.set(enabled, forKey: Self.enabledKey) }
    }

    @Published public var includeAgentOutput: Bool {
        didSet { defaults.set(includeAgentOutput, forKey: Self.includeAgentOutputKey) }
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.enabled = (defaults.object(forKey: Self.enabledKey) as? Bool) ?? true
        self.includeAgentOutput = (defaults.object(forKey: Self.includeAgentOutputKey) as? Bool) ?? true
    }

    /// Returns whether a notification in the given category should be
    /// emitted. Tier 2 is always subordinate to the master toggle.
    public func shouldPost(_ category: NotificationCategory) -> Bool {
        guard enabled else { return false }
        switch category {
        case .systemEvent: return true
        case .agentOutput: return includeAgentOutput
        }
    }
}
