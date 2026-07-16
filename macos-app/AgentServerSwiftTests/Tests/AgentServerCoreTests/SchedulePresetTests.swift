import XCTest
@testable import AgentServerCore

final class SchedulePresetTests: XCTestCase {
    func testNilAndEmptyMapToOnDemand() {
        XCTAssertEqual(SchedulePreset.from(cron: nil), .onDemand)
        XCTAssertEqual(SchedulePreset.from(cron: "  "), .onDemand)
        XCTAssertNil(SchedulePreset.onDemand.cronExpression)
    }

    func testHourlyRoundTrip() {
        XCTAssertEqual(SchedulePreset.from(cron: "0 * * * *"), .hourly)
        XCTAssertEqual(SchedulePreset.hourly.cronExpression, "0 * * * *")
    }

    func testDailyRoundTrip() {
        XCTAssertEqual(SchedulePreset.from(cron: "30 8 * * *"), .daily(hour: 8, minute: 30))
        XCTAssertEqual(SchedulePreset.daily(hour: 8, minute: 30).cronExpression, "30 8 * * *")
    }

    func testWeekdaysRoundTrip() {
        XCTAssertEqual(SchedulePreset.from(cron: "0 9 * * 1-5"), .weekdays(hour: 9, minute: 0))
        XCTAssertEqual(SchedulePreset.weekdays(hour: 9, minute: 0).cronExpression, "0 9 * * 1-5")
    }

    func testWeeklyRoundTrip() {
        XCTAssertEqual(SchedulePreset.from(cron: "15 7 * * 1"), .weekly(weekday: 1, hour: 7, minute: 15))
        XCTAssertEqual(
            SchedulePreset.weekly(weekday: 1, hour: 7, minute: 15).cronExpression,
            "15 7 * * 1"
        )
    }

    func testUnrecognizedShapesStayCustom() {
        XCTAssertEqual(SchedulePreset.from(cron: "*/5 * * * *"), .custom("*/5 * * * *"))
        XCTAssertEqual(SchedulePreset.from(cron: "0 9 1 * *"), .custom("0 9 1 * *"))
        XCTAssertEqual(SchedulePreset.from(cron: "0 9 * * 2,6"), .custom("0 9 * * 2,6"))
        XCTAssertEqual(SchedulePreset.from(cron: "not a cron"), .custom("not a cron"))
    }

    func testCustomPreservesExpression() {
        let preset = SchedulePreset.custom("*/10 9-17 * * 1-5")
        XCTAssertEqual(preset.cronExpression, "*/10 9-17 * * 1-5")
        XCTAssertNil(SchedulePreset.custom("   ").cronExpression)
    }

    func testOutOfRangeValuesStayCustom() {
        XCTAssertEqual(SchedulePreset.from(cron: "99 9 * * *"), .custom("99 9 * * *"))
        XCTAssertEqual(SchedulePreset.from(cron: "0 25 * * *"), .custom("0 25 * * *"))
        XCTAssertEqual(SchedulePreset.from(cron: "0 9 * * 9"), .custom("0 9 * * 9"))
    }
}
