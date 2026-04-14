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
}
