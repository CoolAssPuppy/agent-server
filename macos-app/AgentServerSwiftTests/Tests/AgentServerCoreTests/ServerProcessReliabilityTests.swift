import XCTest
@testable import AgentServerCore

final class ServerProcessReliabilityTests: XCTestCase {
    func testCurrentServerAPIVersionCanBeAdopted() {
        XCTAssertFalse(LocalServerCompatibility.shouldReplace(apiVersion: 9))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 8))
    }

    func testMissingOrOlderServerAPIVersionMustBeReplaced() {
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: nil))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 1))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 2))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 3))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 4))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 5))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 6))
    }

    func testNodeResolverPrefersExecutableOverride() throws {
        let resolved = try NodeExecutableResolver.resolve(
            override: "/custom/node",
            path: "/first:/second",
            isExecutable: { $0 == "/custom/node" }
        )

        XCTAssertEqual(resolved, "/custom/node")
    }

    func testNodeResolverUsesConfiguredChildPathOrder() throws {
        let resolved = try NodeExecutableResolver.resolve(
            override: nil,
            path: "/first:/second:/third",
            isExecutable: { $0 == "/second/node" || $0 == "/third/node" }
        )

        XCTAssertEqual(resolved, "/second/node")
    }

    func testNodeResolverRejectsInvalidExplicitOverride() {
        XCTAssertThrowsError(try NodeExecutableResolver.resolve(
            override: "/missing/node",
            path: "/valid",
            isExecutable: { $0 == "/valid/node" }
        )) { error in
            XCTAssertEqual(error as? NodeExecutableResolutionError, .invalidOverride)
        }
    }

    func testNodeResolverReportsMissingExecutableWithoutHardcodedFallback() {
        XCTAssertThrowsError(try NodeExecutableResolver.resolve(
            override: nil,
            path: "/one:/two",
            isExecutable: { _ in false }
        )) { error in
            XCTAssertEqual(error as? NodeExecutableResolutionError, .notFound)
        }
    }

    func testExternalPIDParserAcceptsOnlyUniquePositiveDecimalIdentifiers() {
        let output = "42\n0\n-1\n42\n123x\n  73  \n"

        XCTAssertEqual(ExternalProcessPIDParser.parse(output), [42, 73])
    }

    func testLifecycleOnlyStopsProcessesStartedByThisApp() {
        var lifecycle = ServerProcessLifecycle()
        lifecycle.observedExistingServer()
        XCTAssertFalse(lifecycle.shouldStopProcess)

        lifecycle.didLaunchServer()
        XCTAssertTrue(lifecycle.shouldStopProcess)

        lifecycle.didStopServer()
        XCTAssertFalse(lifecycle.shouldStopProcess)
    }
}
