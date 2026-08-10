import Foundation

/// What the local server says about this Mac's pairing with Agent Panel.
///
/// The credential is deliberately absent. This travels to a settings screen,
/// which has no use for a secret it cannot spend.
public struct PairingStatus: Codable, Equatable, Sendable {
    public let paired: Bool
    /// Whether the running daemon is reporting with the stored credential.
    /// Configuration is read at startup, so pairing lands on disk first and
    /// only a restart puts it to work.
    public let inUse: Bool
    public let displayName: String?
    public let machineID: String?
    public let pairedAt: String?

    public init(
        paired: Bool,
        inUse: Bool,
        displayName: String? = nil,
        machineID: String? = nil,
        pairedAt: String? = nil
    ) {
        self.paired = paired
        self.inUse = inUse
        self.displayName = displayName
        self.machineID = machineID
        self.pairedAt = pairedAt
    }

    enum CodingKeys: String, CodingKey {
        case paired
        case inUse = "in_use"
        case displayName = "display_name"
        case machineID = "machine_id"
        case pairedAt = "paired_at"
    }
}

/// The sentences the settings screen shows about pairing.
///
/// Written here rather than in the view so the wording is testable, and so
/// the three states stay distinguishable. Before this existed, a paired Mac
/// and an unpaired one looked identical after a restart: the success line was
/// view state, and it died with the view.
public enum PairingPresentation {
    /// Headline for the current state, or nil when this Mac has never paired
    /// and the screen should show nothing but the form.
    public static func summary(for status: PairingStatus) -> String? {
        guard status.paired else { return nil }

        let name = status.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? "this Mac"
        if status.inUse {
            return "Paired with Agent Panel as \"\(name)\"."
        }
        return "Paired as \"\(name)\", but not in use yet. Restart Agent Server to start using it."
    }

    /// Supporting line under the headline. Nil when there is nothing to add.
    public static func detail(for status: PairingStatus, now: Date = Date()) -> String? {
        guard status.paired, let pairedAt = status.pairedAt else { return nil }
        guard let date = iso8601.date(from: pairedAt) ?? iso8601NoFraction.date(from: pairedAt) else {
            return nil
        }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Paired \(formatter.localizedString(for: date, relativeTo: now))."
    }

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601NoFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
