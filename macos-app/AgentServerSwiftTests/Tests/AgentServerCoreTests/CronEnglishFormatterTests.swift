import XCTest
@testable import AgentServerCore

final class CronEnglishFormatterTests: XCTestCase {
    func testEveryFiveMinutes() {
        XCTAssertEqual(CronEnglishFormatter.describe("*/5 * * * *"), "Every 5 minutes")
    }

    func testEveryHour() {
        XCTAssertEqual(CronEnglishFormatter.describe("0 * * * *"), "Every hour")
    }

    func testEveryTwoHours() {
        XCTAssertEqual(CronEnglishFormatter.describe("0 */2 * * *"), "Every 2 hours")
    }

    func testDailyAtNine() {
        XCTAssertEqual(CronEnglishFormatter.describe("0 9 * * *"), "Daily at 9:00 AM")
    }

    func testWeekdaysAtNine() {
        XCTAssertEqual(CronEnglishFormatter.describe("0 9 * * 1-5"), "Weekdays at 9:00 AM")
    }

    func testWeekendsAtNine() {
        XCTAssertEqual(CronEnglishFormatter.describe("0 9 * * 6,0"), "Weekends at 9:00 AM")
    }

    func testMwfAtNine() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9 * * 1,3,5"),
            "Monday, Wednesday, Friday at 9:00 AM"
        )
    }

    func testFirstOfMonthAtTwoThirty() {
        XCTAssertEqual(CronEnglishFormatter.describe("30 14 1 * *"), "1st of each month at 2:30 PM")
    }

    func testEveryFifteenMinutes() {
        XCTAssertEqual(CronEnglishFormatter.describe("*/15 * * * *"), "Every 15 minutes")
    }

    func testUnparseableReturnsRaw() {
        XCTAssertEqual(CronEnglishFormatter.describe("not a cron"), "not a cron")
        XCTAssertEqual(CronEnglishFormatter.describe(""), "")
        XCTAssertEqual(CronEnglishFormatter.describe("@yearly"), "@yearly")
    }

    // Lenient parse: users sometimes write "0 7 * * 2 6" (space-separated
    // day list, non-canonical cron) instead of "0 7 * * 2,6".
    func testDayOfWeekRange() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 7 * * 2-6"),
            "Tuesday–Saturday at 7:00 AM"
        )
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9 * * 0-3"),
            "Sunday–Wednesday at 9:00 AM"
        )
    }

    func testSpaceSeparatedDayOfWeekList() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 7 * * 2 6"),
            "Tuesday, Saturday at 7:00 AM"
        )
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9 * * 1 3 5"),
            "Monday, Wednesday, Friday at 9:00 AM"
        )
    }

    // Hour ranges with minute steps — "during market/work hours" style.
    func testStepMinutesWithHourRangeAndWeekdays() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("*/30 9-16 * * 1-5"),
            "Every 30 minutes, 9 AM–4 PM, weekdays"
        )
        XCTAssertEqual(
            CronEnglishFormatter.describe("*/5 9-17 * * 1-5"),
            "Every 5 minutes, 9 AM–5 PM, weekdays"
        )
    }

    func testStepMinutesWithHourRangeAllDays() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("*/15 9-17 * * *"),
            "Every 15 minutes, 9 AM–5 PM"
        )
    }

    func testHourlyWithHourRangeAndWeekdays() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9-16 * * 1-5"),
            "Hourly, 9 AM–4 PM, weekdays"
        )
    }

    func testStepMinutesOnlyWithWeekdays() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("*/10 * * * 1-5"),
            "Every 10 minutes, weekdays"
        )
    }

    func testStepHoursWithinRange() {
        // "0 7-19/3 * * *" runs at minute 0 every 3 hours from 7 to 19.
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 7-19/3 * * *"),
            "Every 3 hours, 7 AM–7 PM"
        )
    }

    func testStepHoursWithinRangeAndWeekdays() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9-17/2 * * 1-5"),
            "Every 2 hours, 9 AM–5 PM, weekdays"
        )
    }

    func testStepHoursOfOneReadsHourly() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0 9-17/1 * * *"),
            "Hourly, 9 AM–5 PM"
        )
    }

    func testMinuteListAtOneHourReadsAsTimes() {
        XCTAssertEqual(
            CronEnglishFormatter.describe("0,20,40 3 * * *"),
            "Daily at 3:00 AM, 3:20 AM and 3:40 AM"
        )
        XCTAssertEqual(
            CronEnglishFormatter.describe("0,30 9 * * 1-5"),
            "Weekdays at 9:00 AM and 9:30 AM"
        )
    }

    // MARK: - Recovery attempts

    // Every scheduled agent that fires more than once a day pairs the cron with
    // rerun_policy: skip_if_completed_today. The later firings only do work when
    // the first one died, so the schedule is the first firing and the rest are
    // retries.

    private func recovering(_ expression: String) -> CronScheduleDescription {
        CronEnglishFormatter.schedule(expression, rerunPolicy: .skipIfCompletedToday)
    }

    func testDailyAdSpendWatchRunsOnceWithTwoRetries() {
        let described = recovering("0,20,40 16 * * *")
        XCTAssertEqual(described.summary, "Daily at 4:00 PM")
        XCTAssertEqual(described.retryNote, "Retries at 4:20 PM and 4:40 PM if it fails")
    }

    func testDailyFocusRunsOnceOnItsWeekdayRange() {
        let described = recovering("0,20,40 7 * * 2-5")
        XCTAssertEqual(described.summary, "Tuesday–Friday at 7:00 AM")
        XCTAssertEqual(described.retryNote, "Retries at 7:20 AM and 7:40 AM if it fails")
    }

    func testDailyManuscriptReviewRunsOnce() {
        let described = recovering("0,20,40 3 * * *")
        XCTAssertEqual(described.summary, "Daily at 3:00 AM")
        XCTAssertEqual(described.retryNote, "Retries at 3:20 AM and 3:40 AM if it fails")
    }

    func testDailyPortugueseAndFrenchRunsOnce() {
        let described = recovering("0,20,40 5 * * *")
        XCTAssertEqual(described.summary, "Daily at 5:00 AM")
        XCTAssertEqual(described.retryNote, "Retries at 5:20 AM and 5:40 AM if it fails")
    }

    // Two-hour recovery windows used to read "Custom schedule", because a
    // minute list crossed with an hour range is a shape the formatter cannot
    // name. Collapsing the retries leaves a shape it can.
    func testCmoCoachingRunsOnceOnSaturday() {
        let described = recovering("0,20,40 9-10 * * 6")
        XCTAssertEqual(described.summary, "Saturday at 9:00 AM")
        XCTAssertEqual(described.retryNote, "Retries every 20 minutes until 10:40 AM if it fails")
    }

    func testWeeklyGoalsReportRunsOnceOnMonday() {
        let described = recovering("0,20,40 7-8 * * 1")
        XCTAssertEqual(described.summary, "Monday at 7:00 AM")
        XCTAssertEqual(described.retryNote, "Retries every 20 minutes until 8:40 AM if it fails")
    }

    func testWeeklyStatusReportRunsOnceOnWednesday() {
        let described = recovering("0,20,40 9-10 * * 3")
        XCTAssertEqual(described.summary, "Wednesday at 9:00 AM")
        XCTAssertEqual(described.retryNote, "Retries every 20 minutes until 10:40 AM if it fails")
    }

    // proactive-work has no rerun policy: it genuinely runs every three hours,
    // and must keep saying so.
    func testRepeatingScheduleWithoutARerunPolicyIsUnchanged() {
        let described = CronEnglishFormatter.schedule("0 7-19/3 * * *")
        XCTAssertEqual(described.summary, "Every 3 hours, 7 AM–7 PM")
        XCTAssertNil(described.retryNote)
    }

    func testMinuteListWithoutARerunPolicyStillListsEveryFiring() {
        let described = CronEnglishFormatter.schedule("0,20,40 16 * * *")
        XCTAssertEqual(described.summary, "Daily at 4:00 PM, 4:20 PM and 4:40 PM")
        XCTAssertNil(described.retryNote)
    }

    func testSingleFiringScheduleGainsNoRetryNote() {
        let described = recovering("0 9 * * 1-5")
        XCTAssertEqual(described.summary, "Weekdays at 9:00 AM")
        XCTAssertNil(described.retryNote)
    }

    func testUnnameableScheduleStaysCustomEvenWithARerunPolicy() {
        let described = recovering("@yearly")
        XCTAssertEqual(described.summary, "Custom schedule")
        XCTAssertNil(described.retryNote)
    }

    func testSingleRetryReadsAsOneTime() {
        let described = recovering("0,30 6 * * *")
        XCTAssertEqual(described.summary, "Daily at 6:00 AM")
        XCTAssertEqual(described.retryNote, "Retries at 6:30 AM if it fails")
    }

    // Unevenly spaced retries cannot claim an interval, so they report only
    // how long the recovery window stays open.
    func testUnevenRetriesReportOnlyTheWindow() {
        let described = recovering("0,5,25,55 8 * * *")
        XCTAssertEqual(described.summary, "Daily at 8:00 AM")
        XCTAssertEqual(described.retryNote, "Retries until 8:55 AM if it fails")
    }

    func testLabelNeverShowsCronNotation() {
        // describe() may echo shapes it cannot phrase; label() is what
        // screens use, and a screen never shows an asterisk.
        XCTAssertEqual(CronEnglishFormatter.label("0 9 * * 1"), CronEnglishFormatter.describe("0 9 * * 1"))
        XCTAssertEqual(CronEnglishFormatter.label("5 4 3 2 1"), "Custom schedule")
        XCTAssertEqual(CronEnglishFormatter.label("@yearly"), "Custom schedule")
        XCTAssertEqual(CronEnglishFormatter.label("not a cron"), "Custom schedule")
    }
}
