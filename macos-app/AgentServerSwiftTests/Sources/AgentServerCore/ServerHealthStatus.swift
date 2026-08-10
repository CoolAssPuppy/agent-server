import Foundation

/// Whether Agent Panel is hearing from this Mac, as reported by /health.
///
/// The server counts every delivery outcome; this is that count on screen.
/// Before it existed, a dead credential meant runs quietly stopped appearing
/// in Panel and the only evidence was a server log.
public struct PanelReportingStatus: Codable, Equatable, Sendable {
    public enum State: String, Codable, Equatable, Sendable {
        /// No delivery has been attempted since the server started.
        case unknown
        case ok
        case failing
    }

    public let state: State
    public let lastSuccessAt: String?
    public let lastFailureAt: String?
    /// Short reason, e.g. "HTTP 401".
    public let lastFailure: String?
    public let consecutiveFailures: Int

    public init(
        state: State,
        lastSuccessAt: String? = nil,
        lastFailureAt: String? = nil,
        lastFailure: String? = nil,
        consecutiveFailures: Int = 0
    ) {
        self.state = state
        self.lastSuccessAt = lastSuccessAt
        self.lastFailureAt = lastFailureAt
        self.lastFailure = lastFailure
        self.consecutiveFailures = consecutiveFailures
    }

    enum CodingKeys: String, CodingKey {
        case state
        case lastSuccessAt = "last_success_at"
        case lastFailureAt = "last_failure_at"
        case lastFailure = "last_failure"
        case consecutiveFailures = "consecutive_failures"
    }
}

/// The sentences Settings shows about server health. Kept out of the view so
/// the wording is testable and the states stay distinguishable.
public enum ServerHealthPresentation {
    /// A warning line when Panel reporting is failing; nil when there is
    /// nothing to warn about. `unknown` stays silent: a server that has not
    /// tried yet has nothing to confess.
    public static func panelReportingWarning(for status: PanelReportingStatus) -> String? {
        guard status.state == .failing else { return nil }

        var sentence = "Runs are not reaching Agent Panel"
        if let reason = status.lastFailure, !reason.isEmpty {
            sentence += " (\(reason))"
        }
        sentence += "."
        if status.lastSuccessAt != nil, let since = relativeTime(status.lastSuccessAt) {
            sentence += " Panel last heard from this Mac \(since)."
        }
        return sentence
    }

    /// A warning line when the running server is not the version this app
    /// shipped with; nil when they match or the server has not said.
    ///
    /// The app launches the server, so a mismatch means it is launching the
    /// wrong one -- most likely an AGENT_SERVER_LOCATION override pointing at
    /// an old checkout. That override once ran a two-day-old server while the
    /// app looked current, and nothing on screen said so.
    public static func versionSkewWarning(
        appVersion: String,
        serverVersion: String?
    ) -> String? {
        guard let serverVersion, !serverVersion.isEmpty, !appVersion.isEmpty else { return nil }
        guard serverVersion != appVersion else { return nil }

        return "This app is version \(appVersion), but the server it is running is \(serverVersion). "
            + "Quit Agent Server and open it again. If this comes back, a custom server location "
            + "(AGENT_SERVER_LOCATION) is pointing at an old build."
    }

    private static func relativeTime(_ iso: String?, now: Date = Date()) -> String? {
        guard let iso, let date = parseISO(iso) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }

    private static func parseISO(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}
