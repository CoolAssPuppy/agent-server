import Foundation

/// Bidirectional mapping between the consumer schedule picker and cron
/// expressions. Only the shapes the picker can produce are recognized;
/// everything else round-trips as `.custom` so hand-written schedules are
/// never rewritten behind the user's back.
public enum SchedulePreset: Equatable {
    case onDemand
    case hourly
    case daily(hour: Int, minute: Int)
    case weekdays(hour: Int, minute: Int)
    /// `weekday` uses cron numbering: 0 = Sunday ... 6 = Saturday.
    case weekly(weekday: Int, hour: Int, minute: Int)
    case custom(String)

    public static let weekdayNames = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]

    public static func from(cron: String?) -> SchedulePreset {
        guard let cron else { return .onDemand }
        let trimmed = cron.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return .onDemand }

        let fields = trimmed
            .split(separator: " ", omittingEmptySubsequences: true)
            .map(String.init)
        guard fields.count == 5 else { return .custom(trimmed) }

        if fields == ["0", "*", "*", "*", "*"] {
            return .hourly
        }

        guard let minute = Int(fields[0]), (0...59).contains(minute),
              let hour = Int(fields[1]), (0...23).contains(hour),
              fields[2] == "*", fields[3] == "*" else {
            return .custom(trimmed)
        }

        switch fields[4] {
        case "*":
            return .daily(hour: hour, minute: minute)
        case "1-5":
            return .weekdays(hour: hour, minute: minute)
        default:
            if let weekday = Int(fields[4]), (0...6).contains(weekday) {
                return .weekly(weekday: weekday, hour: hour, minute: minute)
            }
            return .custom(trimmed)
        }
    }

    /// The cron expression to persist. `nil` means run on demand (no
    /// `schedule` field in the agent file).
    public var cronExpression: String? {
        switch self {
        case .onDemand:
            return nil
        case .hourly:
            return "0 * * * *"
        case .daily(let hour, let minute):
            return "\(minute) \(hour) * * *"
        case .weekdays(let hour, let minute):
            return "\(minute) \(hour) * * 1-5"
        case .weekly(let weekday, let hour, let minute):
            return "\(minute) \(hour) * * \(weekday)"
        case .custom(let cron):
            let trimmed = cron.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? nil : trimmed
        }
    }
}
