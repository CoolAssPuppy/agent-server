import XCTest
@testable import AgentServerCore

final class TelemetryProgressSettingsTests: XCTestCase {
    func testAbsentValuesUseServerDefaults() {
        XCTAssertEqual(
            TelemetryProgressSettings(environment: []),
            TelemetryProgressSettings(
                mode: .live,
                sampleSeconds: 5,
                maxEntries: 50,
                includesMetadata: false
            )
        )
    }

    func testStoredValuesAreParsedAndClampedToSupportedRanges() {
        let settings = TelemetryProgressSettings(environment: [
            EnvPair(key: TelemetryProgressSettings.modeKey, value: "batched"),
            EnvPair(key: TelemetryProgressSettings.sampleMillisecondsKey, value: "900000"),
            EnvPair(key: TelemetryProgressSettings.maxEntriesKey, value: "0"),
            EnvPair(key: TelemetryProgressSettings.includesMetadataKey, value: "true"),
        ])

        XCTAssertEqual(settings.mode, .batched)
        XCTAssertEqual(settings.sampleSeconds, 600)
        XCTAssertEqual(settings.maxEntries, 1)
        XCTAssertTrue(settings.includesMetadata)
    }

    func testMalformedValuesFallBackToDefaults() {
        let settings = TelemetryProgressSettings(environment: [
            EnvPair(key: TelemetryProgressSettings.modeKey, value: "streaming"),
            EnvPair(key: TelemetryProgressSettings.sampleMillisecondsKey, value: "fast"),
            EnvPair(key: TelemetryProgressSettings.maxEntriesKey, value: "many"),
            EnvPair(key: TelemetryProgressSettings.includesMetadataKey, value: "yes"),
        ])

        XCTAssertEqual(settings, .default)
    }

    func testPersistenceReplacesKnownValuesAndPreservesUnrelatedOrdering() {
        let original = [
            EnvPair(key: "FIRST", value: "kept"),
            EnvPair(key: TelemetryProgressSettings.modeKey, value: "live"),
            EnvPair(key: "LAST", value: "kept"),
        ]
        let settings = TelemetryProgressSettings(
            mode: .batched,
            sampleSeconds: 12,
            maxEntries: 25,
            includesMetadata: true
        )

        XCTAssertEqual(settings.applying(to: original), [
            EnvPair(key: "FIRST", value: "kept"),
            EnvPair(key: TelemetryProgressSettings.modeKey, value: "batched"),
            EnvPair(key: "LAST", value: "kept"),
            EnvPair(key: TelemetryProgressSettings.sampleMillisecondsKey, value: "12000"),
            EnvPair(key: TelemetryProgressSettings.maxEntriesKey, value: "25"),
            EnvPair(key: TelemetryProgressSettings.includesMetadataKey, value: "true"),
        ])
    }
}
