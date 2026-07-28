import Foundation

/// Every product-analytics event the macOS app sends, named once.
///
/// Naming: `object_action`, snake_case, action in the past tense.
/// `agent_created`, `run_failed`, `connection_removed`.
///
/// A typed enum rather than raw strings because a typo in a string literal is a
/// silent second event in the analytics backend that nobody notices for months.
///
/// The bundled CLI daemon has its own catalog in
/// `server-app/src/analytics/events.ts`. Where the two overlap they use
/// different names on purpose, and every event from either surface carries a
/// `source` property saying which one sent it.
public enum TelemetryEvent: String {

    // MARK: App lifecycle
    ///
    /// Ours, not the SDK's. `captureApplicationLifecycleEvents` is off in
    /// `PostHogDestination.setup()` because a menu bar app's launch and window
    /// churn would drown the handful of events that mean something.
    case appLaunched = "app_launched"
    case windowOpened = "window_opened"

    // MARK: Agents observed
    ///
    /// Derived from the poll loop rather than from a user action: the daemon
    /// runs agents whether or not anybody is looking at the app.
    case agentDiscovered = "agent_discovered"
    case runStarted = "run_started"
    case runCompleted = "run_completed"
    case runFailed = "run_failed"

    // MARK: Agents changed
    case agentCreated = "agent_created"
    case agentCreationFailed = "agent_creation_failed"
    case agentUpdated = "agent_updated"
    case agentDeleted = "agent_deleted"
    case agentCapabilityToggled = "agent_capability_toggled"
    case agentCreationUnsupportedServicesMentioned = "agent_creation_unsupported_services_mentioned"

    // MARK: Runs the user drives
    case runTriggered = "run_triggered"
    case runTriggerFailed = "run_trigger_failed"
    case runCancelled = "run_cancelled"
    case runHistoryPanelEnrichmentFailed = "run_history_panel_enrichment_failed"

    // MARK: Decisions
    case decisionEmitted = "decision_emitted"
    case decisionResolved = "decision_resolved"

    // MARK: Connections
    case connectionCreated = "connection_created"
    case connectionRemoved = "connection_removed"
    case connectionKeysSaved = "connection_keys_saved"

    // MARK: Daemon
    ///
    /// The macOS app's view of the bundled server process, which is a different
    /// thing from the daemon's own `server_started`: this fires even when the
    /// daemon never got far enough to report anything itself.
    case daemonLaunchFailed = "daemon_launch_failed"
    case daemonRestartRequested = "daemon_restart_requested"

    // MARK: Settings
    ///
    /// One event with a `setting` property rather than a case per switch, so a
    /// new toggle in Settings does not need a new event name.
    case settingChanged = "setting_changed"

    // MARK: Updates
    case updateCheckRequested = "update_check_requested"
    case updateInstalled = "update_installed"
}
