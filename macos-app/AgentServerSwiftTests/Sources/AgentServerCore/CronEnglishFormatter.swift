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
