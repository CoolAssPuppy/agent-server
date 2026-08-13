import Foundation

/// Converts a 5-field cron expression (minute hour day-of-month month day-of-week)
/// into a plain-English description. Returns the raw expression when the shape
/// is not one of the supported patterns. Intended for display only.
/// How an agent treats the firings after the first one on a given day.
/// `skip_if_completed_today` makes every later firing a no-op once a run has
/// completed, which turns them into recovery attempts rather than extra runs.
public enum CronRerunPolicy: String, Sendable {
    case skipIfCompletedToday = "skip_if_completed_today"
}

/// A schedule split into the run to expect and the recovery attempts behind it.
/// `retryNote` is nil when the schedule fires once a day, or when the agent has
/// no rerun policy and every firing is real work.
public struct CronScheduleDescription: Equatable, Sendable {
    public let summary: String
    public let retryNote: String?

    public init(summary: String, retryNote: String?) {
        self.summary = summary
        self.retryNote = retryNote
    }
}

public enum CronEnglishFormatter {
    private static let customLabel = "Custom schedule"

    public static func describe(_ expression: String) -> String {
        guard let fields = normalizedFields(expression) else { return expression }

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

        // Patterns with an hour range (e.g. "9-16"), optionally stepped
        // ("7-19/3"), in the hour field. These cover "during trading / work
        // hours" schedules like `*/30 9-16 * * 1-5` and "every N hours from
        // start to end" schedules like `0 7-19/3 * * *`.
        if dayOfMonth == "*", month == "*", let hourRange = parseHourRange(hour) {
            let dowSuffix = dayOfWeekSuffix(dayOfWeek)
            // A stepped hour range at minute 0 reads as "Every N hours, range".
            if let hourStep = hourRange.step, minute == "0" {
                let head = hourStep == 1 ? "Hourly" : "Every \(hourStep) hours"
                return "\(head), \(hourRange.label)\(dowSuffix)"
            }
            if let step = stepValue(minute) {
                let head = step == 1 ? "Every minute" : "Every \(step) minutes"
                return "\(head), \(hourRange.label)\(dowSuffix)"
            }
            if minute == "0" {
                return "Hourly, \(hourRange.label)\(dowSuffix)"
            }
            if let minuteValue = Int(minute), (0...59).contains(minuteValue) {
                return "At :\(String(format: "%02d", minuteValue)), \(hourRange.label)\(dowSuffix)"
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

        // A list of minutes at one hour: "0,20,40 3 * * *". Recovery-attempt
        // schedules look like this, and the raw field list was reaching the
        // screen as cron notation.
        if minute.contains(","), let hourValue = Int(hour), (0...23).contains(hourValue),
           dayOfMonth == "*", month == "*" {
            let minuteValues = minute.split(separator: ",").compactMap { Int($0) }
            if minuteValues.count == minute.split(separator: ",").count,
               minuteValues.allSatisfy({ (0...59).contains($0) }) {
                let times = minuteValues.map { formatTime(hour: hourValue, minute: $0) }
                let joined = times.count == 2
                    ? times.joined(separator: " and ")
                    : times.dropLast().joined(separator: ", ") + " and " + times[times.count - 1]
                if dayOfWeek == "*" {
                    return "Daily at \(joined)"
                }
                if let label = describeDayOfWeek(dayOfWeek) {
                    return "\(label) at \(joined)"
                }
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

    /// `describe`, but guaranteed fit for a screen: when the expression is a
    /// shape `describe` cannot phrase, this says "Custom schedule" instead of
    /// echoing cron notation at somebody who never wrote it.
    public static func label(_ expression: String) -> String {
        let described = describe(expression)
        if described == expression.trimmingCharacters(in: .whitespaces) || described.contains("*") {
            return customLabel
        }
        return described
    }

    /// Splits a schedule into the run people should expect and the recovery
    /// attempts behind it. Under `skip_if_completed_today` the first firing of
    /// the day is the schedule and every later one only runs if that first one
    /// died, so listing them all as the schedule tells the reader an agent runs
    /// three times a day when it runs once.
    public static func schedule(
        _ expression: String,
        rerunPolicy: CronRerunPolicy? = nil
    ) -> CronScheduleDescription {
        let everyFiring = CronScheduleDescription(summary: label(expression), retryNote: nil)
        guard rerunPolicy == .skipIfCompletedToday,
              let fields = normalizedFields(expression),
              let firings = dailyFirings(minute: fields[0], hour: fields[1]),
              firings.count > 1,
              let first = firings.first else { return everyFiring }

        let collapsed = "\(first.minute) \(first.hour) \(fields[2]) \(fields[3]) \(fields[4])"
        let summary = label(collapsed)
        guard summary != customLabel else { return everyFiring }
        return CronScheduleDescription(
            summary: summary,
            retryNote: retryNote(for: Array(firings.dropFirst()))
        )
    }

    /// The five cron fields, or nil when the expression has some other shape.
    /// Lenient: users sometimes write "0 7 * * 2 6" (space-separated day list)
    /// instead of the canonical "0 7 * * 2,6", so extra trailing fields are
    /// folded into a comma-joined day-of-week list.
    private static func normalizedFields(_ expression: String) -> [String]? {
        let trimmed = expression.trimmingCharacters(in: .whitespaces)
        let rawFields = trimmed.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        if rawFields.count > 5 {
            return Array(rawFields.prefix(4)) + [rawFields.suffix(from: 4).joined(separator: ",")]
        }
        return rawFields.count == 5 ? rawFields : nil
    }

    // MARK: - Firings within one day

    private struct Firing: Equatable {
        let hour: Int
        let minute: Int
    }

    /// Every time of day the minute and hour fields fire at, in order. Nil when
    /// either field is a shape this expander does not read.
    private static func dailyFirings(minute: String, hour: String) -> [Firing]? {
        guard let minutes = expandField(minute, upperBound: 59),
              let hours = expandField(hour, upperBound: 23),
              !minutes.isEmpty, !hours.isEmpty else { return nil }
        return hours.flatMap { hour in minutes.map { Firing(hour: hour, minute: $0) } }
    }

    /// Expands a comma-separated cron field into its values.
    private static func expandField(_ field: String, upperBound: Int) -> [Int]? {
        var values: Set<Int> = []
        for term in field.split(separator: ",") {
            guard let expanded = expandTerm(String(term), upperBound: upperBound) else { return nil }
            values.formUnion(expanded)
        }
        return values.sorted()
    }

    /// Expands one term: `*`, `*/S`, `N`, `N-M`, or `N-M/S`.
    private static func expandTerm(_ term: String, upperBound: Int) -> [Int]? {
        var body = term
        var step = 1
        if let slash = term.firstIndex(of: "/") {
            guard let parsed = Int(term[term.index(after: slash)...]), parsed > 0 else { return nil }
            step = parsed
            body = String(term[..<slash])
        }

        let start: Int
        let end: Int
        if body == "*" {
            start = 0
            end = upperBound
        } else if body.contains("-") {
            let parts = body.split(separator: "-")
            guard parts.count == 2,
                  let low = Int(parts[0]),
                  let high = Int(parts[1]),
                  low <= high else { return nil }
            start = low
            end = high
        } else {
            guard let single = Int(body) else { return nil }
            start = single
            end = single
        }

        guard start >= 0, end <= upperBound else { return nil }
        return Array(stride(from: start, through: end, by: step))
    }

    /// One sentence for the recovery attempts. Two or fewer are worth naming
    /// outright; past that the list runs longer than the schedule it explains,
    /// so an evenly spaced run reports its interval instead.
    private static func retryNote(for retries: [Firing]) -> String? {
        guard let last = retries.last else { return nil }
        let times = retries.map { formatTime(hour: $0.hour, minute: $0.minute) }
        if times.count == 1 {
            return "Retries at \(times[0]) if it fails"
        }
        if times.count == 2 {
            return "Retries at \(times[0]) and \(times[1]) if it fails"
        }
        let window = formatTime(hour: last.hour, minute: last.minute)
        if let gap = evenGapMinutes(retries) {
            return "Retries every \(gap) minutes until \(window) if it fails"
        }
        return "Retries until \(window) if it fails"
    }

    /// The shared gap between consecutive firings, or nil when they are not
    /// evenly spaced.
    private static func evenGapMinutes(_ firings: [Firing]) -> Int? {
        guard firings.count > 1 else { return nil }
        let minutesOfDay = firings.map { $0.hour * 60 + $0.minute }
        let gap = minutesOfDay[1] - minutesOfDay[0]
        guard gap > 0 else { return nil }
        for index in 1..<minutesOfDay.count where minutesOfDay[index] - minutesOfDay[index - 1] != gap {
            return nil
        }
        return gap
    }

    /// Parses an hour range field like `9-16`, or a stepped range like
    /// `7-19/3`, into a formatted label (`9 AM–4 PM`) plus the optional step.
    /// Returns nil if the field isn't a simple integer range in 0–23.
    private static func parseHourRange(_ field: String) -> (label: String, step: Int?)? {
        guard field.contains("-"), !field.contains(",") else { return nil }
        var rangePart = field
        var step: Int?
        if let slash = field.firstIndex(of: "/") {
            guard let parsed = Int(field[field.index(after: slash)...]), parsed > 0 else { return nil }
            step = parsed
            rangePart = String(field[..<slash])
        }
        let parts = rangePart.split(separator: "-")
        guard parts.count == 2,
              let start = Int(parts[0]), (0...23).contains(start),
              let end = Int(parts[1]), (0...23).contains(end),
              start < end else { return nil }
        return ("\(formatHour(start))–\(formatHour(end))", step)
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
