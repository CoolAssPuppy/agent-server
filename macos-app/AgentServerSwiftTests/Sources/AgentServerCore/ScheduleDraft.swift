import Foundation

public struct ScheduleDraft: Equatable, Sendable {
    public enum Frequency: String, CaseIterable, Identifiable, Sendable {
        case onDemand = "On demand"
        case hourly = "Every hour"
        case daily = "Every day"
        case weekdays = "Weekdays"
        case weekly = "Once a week"
        case custom = "Custom"

        public var id: String { rawValue }
    }

    public var frequency: Frequency
    public var time: Date
    public var weekday: Int
    public var customCron: String

    public init() {
        frequency = .onDemand
        time = Self.time(hour: 9, minute: 0)
        weekday = 1
        customCron = ""
    }

    public init(cron: String?) {
        self.init()
        switch SchedulePreset.from(cron: cron) {
        case .onDemand: frequency = .onDemand
        case .hourly: frequency = .hourly
        case .daily(let hour, let minute):
            frequency = .daily
            time = Self.time(hour: hour, minute: minute)
        case .weekdays(let hour, let minute):
            frequency = .weekdays
            time = Self.time(hour: hour, minute: minute)
        case .weekly(let day, let hour, let minute):
            frequency = .weekly
            weekday = day
            time = Self.time(hour: hour, minute: minute)
        case .custom(let raw):
            frequency = .custom
            customCron = raw
        }
    }

    public var cronExpression: String? {
        let components = Calendar.current.dateComponents([.hour, .minute], from: time)
        let hour = components.hour ?? 9
        let minute = components.minute ?? 0
        return switch frequency {
        case .onDemand: SchedulePreset.onDemand.cronExpression
        case .hourly: SchedulePreset.hourly.cronExpression
        case .daily: SchedulePreset.daily(hour: hour, minute: minute).cronExpression
        case .weekdays: SchedulePreset.weekdays(hour: hour, minute: minute).cronExpression
        case .weekly: SchedulePreset.weekly(weekday: weekday, hour: hour, minute: minute).cronExpression
        case .custom: SchedulePreset.custom(customCron).cronExpression
        }
    }

    private static func time(hour: Int, minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }
}
