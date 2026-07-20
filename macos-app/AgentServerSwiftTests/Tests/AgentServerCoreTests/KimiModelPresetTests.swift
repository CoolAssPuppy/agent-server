import XCTest
@testable import AgentServerCore

final class KimiModelPresetTests: XCTestCase {
    func testKimiPresetTargetsK3ThroughMoonshotWithoutEmbeddingASecret() {
        XCTAssertEqual(KimiModelPreset.displayName, "Kimi K3")
        XCTAssertEqual(KimiModelPreset.model, "kimi-k3")
        XCTAssertEqual(KimiModelPreset.endpoint, "https://api.moonshot.ai/v1")
        XCTAssertEqual(KimiModelPreset.keyVariable, "MOONSHOT_API_KEY")
        XCTAssertEqual(KimiModelPreset.keyReference, "${MOONSHOT_API_KEY}")
    }

    func testKimiPresetOnlyRecognizesTheExactK3Configuration() {
        XCTAssertTrue(
            KimiModelPreset.matches(
                model: "kimi-k3",
                endpoint: "https://api.moonshot.ai/v1"
            )
        )
        XCTAssertFalse(
            KimiModelPreset.matches(
                model: "kimi-k2",
                endpoint: "https://api.moonshot.ai/v1"
            )
        )
    }

    func testKimiRunNamesPreserveTheConfiguredVersion() {
        XCTAssertEqual(ModelDisplayName.format("kimi-k3"), "Kimi K3")
        XCTAssertEqual(ModelDisplayName.format("kimi-k2"), "Kimi K2")
        XCTAssertEqual(ModelDisplayName.format("custom-model"), "custom-model")
    }
}
