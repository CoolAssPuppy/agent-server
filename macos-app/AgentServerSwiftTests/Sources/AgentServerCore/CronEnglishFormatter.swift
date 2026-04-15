import Foundation

/// Converts a 5-field cron expression (minute hour day-of-month month day-of-week)
/// into a plain-English description. Returns the raw expression when the shape
/// is not one of the supported patterns. Intended for display only.
public enum CronEnglishFormatter {
    public static func describe(_ expression: String) -> String {
        let trimmed = expression.trimmingCharacters(in: .whitespaces)
        let rawFields = trimmed.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        // Be lenient: users sometimes write "0 7 * * 2 6" (space-separated day
        // list) instead of the canonical "0 7 * * 2,6". Collapse any extra
        // trailing fields into a comma-joined day-of-week list so the
        // formatter can still produce a readable label.
        let fields: [String]
        if rawFields.count > 5 {
            let head = Array(rawFields.prefix(4))
            let tail = rawFields.suffix(from: 4).joined(separator: ",")
            fields = head + [tail]
        } else {
            fields = rawFields
        }
        guard fields.count == 5 else { return expression }

        let minute = fields[0]
        let hour = fields[1]
        let dayOfMonth = fields[2]
        let month = fields[3]
        let dayOfWeek = fields[4]

        if minute == "*" && hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return "Every minute"
        }

        if let step = stepValue(minute), hour == "*", dayOfMonth == "*", month == "*", dayOfWeek == "*" {
            return step == 1 ? "Every minute" : "Every \(step) minutes"
        }

        if minute == "0", let step = stepValue(hour), dayOfMonth == "*", month == "*", dayOfWeek == "*" {
            return step == 1 ? "Every hour" : "Every \(step) hours"
        }

        if minute == "0", hour == "*", dayOfMonth == "*", month == "*", dayOfWeek == "*" {
            return "Every hour"
        }

        // Patterns with an hour range (e.g. "9-16") in the hour field.
        // These cover the common "during trading hours / work hours" schedules
        // like `*/30 9-16 * * 1-5`.
        if dayOfMonth == "*", month == "*", let hourRange = describeHourRange(hour) {
            let dowSuffix = dayOfWeekSuffix(dayOfWeek)
            if let step = stepValue(minute) {
                let head = step == 1 ? "Every minute" : "Every \(step) minutes"
                return "\(head), \(hourRange)\(dowSuffix)"
            }
            if minute == "0" {
                return "Hourly, \(hourRange)\(dowSuffix)"
            }
            if let minuteValue = Int(minute), (0...59).contains(minuteValue) {
                return "At :\(String(format: "%02d", minuteValue)), \(hourRange)\(dowSuffix)"
            }
        }

        // Minute step with a specific hour or every hour, optional day-of-week.
        // Covers `*/15 9 * * *` → "Every 15 minutes at 9:00 AM" and
        // `*/10 * * * 1-5` → "Every 10 minutes, weekdays".
        if dayOfMonth == "*", month == "*", let step = stepValue(minute) {
            let head = step == 1 ? "Every minute" : "Every \(step) minutes"
            if let hourValue = Int(hour), (0...23).contains(hourValue) {
                let time = formatTime(hour: hourValue, minute: 0).replacingOccurrences(of: ":00 ", with: " ")
                let dowSuffix = dayOfWeekSuffix(dayOfWeek)
                return "\(head) at \(time)\(dowSuffix)"
            }
            if hour == "*", dayOfWeek != "*", let label = describeDayOfWeek(dayOfWeek) {
                return "\(head), \(lowercaseDayLabel(label))"
            }
        }

        if let minuteValue = Int(minute), let hourValue = Int(hour),
           (0...59).contains(minuteValue), (0...23).contains(hourValue),
           month == "*" {
            let time = formatTime(hour: hourValue, minute: minuteValue)

            if dayOfMonth == "*" {
                if dayOfWeek == "*" {
                    return "Daily at \(time)"
                }
                if let label = describeDayOfWeek(dayOfWeek) {
                    return "\(label) at \(time)"
                }
            }

            if dayOfWeek == "*", let day = Int(dayOfMonth), (1...31).contains(day) {
                return "\(ordinal(day)) of each month at \(time)"
            }
        }

        return expression
    }

    /// Formats an hour range field like `9-16` into `9 AM–4 PM`. Returns nil
    /// if the field isn't a simple integer range in 0–23.
    private static func describeHourRange(_ field: String) -> String? {
        guard field.contains("-"), !field.contains(",") else { return nil }
        let parts = field.split(separator: "-")
        guard parts.count == 2,
              let start = Int(parts[0]), (0...23).contains(start),
              let end = Int(parts[1]), (0...23).contains(end),
              start < end else { return nil }
        return "\(formatHour(start))–\(formatHour(end))"
    }

    /// Human-readable hour without minutes: `9 AM`, `4 PM`, `12 PM`.
    private static func formatHour(_ hour: Int) -> String {
        let period = hour >= 12 ? "PM" : "AM"
        let displayHour: Int
        switch hour {
        case 0: displayHour = 12
        case 13...23: displayHour = hour - 12
        default: displayHour = hour
        }
        return "\(displayHour) \(period)"
    }

    /// Returns a leading `, weekdays`-style suffix for the day-of-week field,
    /// or an empty string when it's `*` or unrecognized.
    private static func dayOfWeekSuffix(_ field: String) -> String {
        guard field != "*", let label = describeDayOfWeek(field) else { return "" }
        return ", \(lowercaseDayLabel(label))"
    }

    /// Lowercase the common group labels (`Weekdays`, `Weekends`) so they read
    /// naturally in the middle of a sentence. Specific day names keep their
    /// capitalization.
    private static func lowercaseDayLabel(_ label: String) -> String {
        switch label {
        case "Weekdays": return "weekdays"
        case "Weekends": return "weekends"
        default: return label
        }
    }

    // MARK: - Helpers

    private static func stepValue(_ field: String) -> Int? {
        guard field.hasPrefix("*/") else { return nil }
        return Int(field.dropFirst(2))
    }

    private static func formatTime(hour: Int, minute: Int) -> String {
        let period = hour >= 12 ? "PM" : "AM"
        let displayHour: Int
        switch hour {
        case 0: displayHour = 12
        case 13...23: displayHour = hour - 12
        default: displayHour = hour
        }
        return String(format: "%d:%02d %@", displayHour, minute, period)
    }

    private static let dayFull = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
    ]

    private static func describeDayOfWeek(_ field: String) -> String? {
        // Normalize: cron allows 7 for Sunday as well as 0.
        func normalize(_ value: Int) -> Int? {
            if value == 7 { return 0 }
            return (0...6).contains(value) ? value : nil
        }

        if field == "1-5" { return "Weekdays" }

        // Generic day-of-week range like "2-6" (Tuesday–Saturday).
        if field.contains("-"), !field.contains(",") {
            let parts = field.split(separator: "-")
            if parts.count == 2,
               let start = Int(parts[0]).flatMap(normalize),
               let end = Int(parts[1]).flatMap(normalize),
               start <= end {
                return "\(dayFull[start])–\(dayFull[end])"
            }
        }

        if field.contains(",") {
            let parts = field.split(separator: ",").compactMap { Int($0).flatMap(normalize) }
            guard parts.count == field.split(separator: ",").count else { return nil }
            let unique = Array(Set(parts)).sorted()
            if unique == [0, 6] { return "Weekends" }

            // Preserve original order as written (after normalizing 7->0) for list labels.
            let ordered = parts.map { dayFull[$0] }
            return listJoin(ordered)
        }

        if let single = Int(field), let norm = normalize(single) {
            return dayFull[norm]
        }

        return nil
    }

    private static func listJoin(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        default: return items.joined(separator: ", ")
        }
    }

    private static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch n % 100 {
        case 11, 12, 13:
            suffix = "th"
        default:
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }
}
