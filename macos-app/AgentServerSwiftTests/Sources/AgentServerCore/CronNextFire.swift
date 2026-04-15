import Foundation

/// Best-effort "when does this cron next fire?" for the common patterns
/// used in agent schedules. Returns nil for expressions the formatter
/// doesn't understand so callers can fall back to a safer heuristic.
///
/// Intentionally narrower than a full cron implementation (we only need
/// to drive a "does this fire today?" filter on the MainPane's Tasks
/// Planned Today card). Covered:
///
///   */N * * * *          every N minutes
///   0 */N * * * *        every N hours, on the hour
///   0 * * * *            hourly
///   M H * * *            daily at H:M
///   M H * * 1-5          weekdays at H:M
///   M H * * 6,0          weekends at H:M
///   M H * * D            once a week on day D at H:M
///   M H D * *            monthly on day-of-month D at H:M
public enum CronNextFire {
    public static func next(_ expression: String, after: Date, in timeZone: TimeZone = .current) -> Date? {
        let trimmed = expression.trimmingCharacters(in: .whitespaces)
        let raw = trimmed.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        // Lenient parse — "0 9 * * 2 6" collapses day-list fields back into "2,6".
        let fields: [String]
        if raw.count > 5 {
            fields = Array(raw.prefix(4)) + [raw.suffix(from: 4).joined(separator: ",")]
        } else {
            fields = raw
        }
        guard fields.count == 5 else { return nil }

        let (minute, hour, dom, mon, dow) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        guard mon == "*" else { return nil } // Skip month-specific schedules.

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone

        // Every N minutes.
        if let step = step(minute), hour == "*", dom == "*", dow == "*" {
            guard step > 0 else { return nil }
            let seconds = step * 60
            let next = after.addingTimeInterval(TimeInterval(seconds))
            return next
        }

        // Every N hours (on the hour).
        if minute == "0", let step = step(hour), dom == "*", dow == "*" {
            guard step > 0 else { return nil }
            return cal.date(byAdding: .hour, value: step, to: cal.date(bySetting: .minute, value: 0, of: after) ?? after)
        }

        // Hourly.
        if minute == "0", hour == "*", dom == "*", dow == "*" {
            return cal.date(byAdding: .hour, value: 1, to: cal.date(bySetting: .minute, value: 0, of: after) ?? after)
        }

        guard let m = Int(minute), let h = Int(hour), (0...59).contains(m), (0...23).contains(h) else {
            return nil
        }

        // Monthly on day D at H:M.
        if dow == "*", let d = Int(dom), (1...31).contains(d) {
            return nextMonthly(day: d, hour: h, minute: m, after: after, cal: cal)
        }

        // Daily (any day) or specific weekday pattern.
        if dom == "*" {
            let allowedWeekdays = weekdays(from: dow)
            return nextDaily(hour: h, minute: m, weekdays: allowedWeekdays, after: after, cal: cal)
        }

        return nil
    }

    // MARK: - Helpers

    private static func step(_ field: String) -> Int? {
        guard field.hasPrefix("*/") else { return nil }
        return Int(field.dropFirst(2))
    }

    /// Returns the set of allowed weekdays (1=Sun, 7=Sat per Calendar).
    /// nil = any day. For the cron DOW field 0=Sun, 7=Sun, 6=Sat.
    private static func weekdays(from field: String) -> Set<Int>? {
        if field == "*" { return nil }
        let mapped: (Int) -> Int = { cronDay in
            let normalized = cronDay == 7 ? 0 : cronDay
            return normalized + 1 // Sun=1 in Calendar
        }
        if field == "1-5" { return Set([2, 3, 4, 5, 6]) }
        if field.contains("-"), !field.contains(",") {
            let parts = field.split(separator: "-")
            if parts.count == 2,
               let s = Int(parts[0]), let e = Int(parts[1]),
               s <= e {
                return Set((s...e).map(mapped))
            }
        }
        if field.contains(",") {
            let parts = field.split(separator: ",").compactMap { Int($0) }
            if !parts.isEmpty { return Set(parts.map(mapped)) }
        }
        if let single = Int(field) { return Set([mapped(single)]) }
        return nil
    }

    private static func nextDaily(hour: Int, minute: Int, weekdays: Set<Int>?, after: Date, cal: Calendar) -> Date? {
        let startOfToday = cal.startOfDay(for: after)
        for dayOffset in 0...7 {
            guard let day = cal.date(byAdding: .day, value: dayOffset, to: startOfToday) else { continue }
            if let allowed = weekdays, !allowed.contains(cal.component(.weekday, from: day)) {
                continue
            }
            guard let fire = cal.date(bySettingHour: hour, minute: minute, second: 0, of: day) else {
                continue
            }
            if fire > after { return fire }
        }
        return nil
    }

    private static func nextMonthly(day: Int, hour: Int, minute: Int, after: Date, cal: Calendar) -> Date? {
        var components = cal.dateComponents([.year, .month], from: after)
        for monthsAhead in 0...12 {
            components.month = (components.month ?? 1) + monthsAhead
            components.day = day
            components.hour = hour
            components.minute = minute
            components.second = 0
            if let candidate = cal.date(from: components), candidate > after {
                return candidate
            }
        }
        return nil
    }

    public static func firesToday(_ expression: String, now: Date = Date(), in timeZone: TimeZone = .current) -> Bool {
        guard let next = next(expression, after: now, in: timeZone) else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal.isDate(next, inSameDayAs: now)
    }

    public static func firesTomorrow(_ expression: String, now: Date = Date(), in timeZone: TimeZone = .current) -> Bool {
        guard let next = next(expression, after: now, in: timeZone) else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        guard let tomorrow = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) else { return false }
        return cal.isDate(next, inSameDayAs: tomorrow)
    }
}
