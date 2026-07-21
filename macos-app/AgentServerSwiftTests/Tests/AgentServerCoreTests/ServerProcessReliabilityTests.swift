import XCTest
@testable import AgentServerCore

final class ServerProcessReliabilityTests: XCTestCase {
    func testCurrentServerAPIVersionCanBeAdopted() {
        XCTAssertFalse(LocalServerCompatibility.shouldReplace(apiVersion: 11))
        XCTAssertTrue(LocalServerCompatibility.shouldReplace(apiVersion: 10))
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

    func testHealthyOlderServerStaysRunningWhenReplacementPreflightFails() {
        XCTAssertEqual(
            LocalServerCompatibility.action(apiVersion: 10, replacementIsReady: false),
            .keepExisting
        )
        XCTAssertEqual(
            LocalServerCompatibility.action(apiVersion: 10, replacementIsReady: true),
            .replaceExisting
        )
        XCTAssertEqual(
            LocalServerCompatibility.action(apiVersion: 11, replacementIsReady: true),
            .adoptExisting
        )
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

    func testNodeResolverFindsHomebrewAfterSparkleRelaunchWithSystemPath() throws {
        let resolved = try NodeExecutableResolver.resolve(
            override: nil,
            path: "/usr/bin:/bin:/usr/sbin:/sbin",
            isExecutable: { $0 == "/opt/homebrew/bin/node" }
        )

        XCTAssertEqual(resolved, "/opt/homebrew/bin/node")
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

    func testNodeResolverReportsMissingExecutableWhenNoCandidateExists() {
        XCTAssertThrowsError(try NodeExecutableResolver.resolve(
            override: nil,
            path: "/one:/two",
            isExecutable: { _ in false }
        )) { error in
            XCTAssertEqual(error as? NodeExecutableResolutionError, .notFound)
        }
    }

    func testChildPathRestoresHomebrewCommandsAfterSparkleRelaunch() {
        let path = ChildProcessPathBuilder.build(
            inheritedPath: "/usr/bin:/bin:/usr/sbin:/sbin",
            nodeExecutable: "/opt/homebrew/bin/node"
        )

        XCTAssertEqual(
            path,
            "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
        )
    }

    func testChildPathKeepsEachCommandDirectoryOnlyOnce() {
        let path = ChildProcessPathBuilder.build(
            inheritedPath: "/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin",
            nodeExecutable: "/opt/homebrew/bin/node"
        )

        XCTAssertEqual(
            path.split(separator: ":").filter { $0 == "/opt/homebrew/bin" }.count,
            1
        )
    }

    func testExternalPIDParserAcceptsOnlyUniquePositiveDecimalIdentifiers() {
        let output = "42\n0\n-1\n42\n123x\n  73  \n"

        XCTAssertEqual(ExternalProcessPIDParser.parse(output), [42, 73])
    }

    func testExternalLookupOnlyReturnsListeningProcessesOnTheServerPort() {
        XCTAssertEqual(
            ExternalServerLookup.arguments(port: 47_821),
            ["-nP", "-a", "-iTCP:47821", "-sTCP:LISTEN", "-t"]
        )
    }

    func testOwnedProcessIdentityRequiresMatchingPIDExecutableAndLaunchToken() {
        let expected = ServerProcessIdentity(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            launchToken: "owned-token"
        )

        XCTAssertTrue(expected.matches(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            environment: "PATH=/usr/bin AGENT_SERVER_LAUNCH_TOKEN=owned-token HOME=/tmp"
        ))
        XCTAssertFalse(expected.matches(
            pid: 73,
            executablePath: "/opt/homebrew/bin/node",
            environment: "AGENT_SERVER_LAUNCH_TOKEN=owned-token"
        ))
        XCTAssertFalse(expected.matches(
            pid: 42,
            executablePath: "/usr/bin/node",
            environment: "AGENT_SERVER_LAUNCH_TOKEN=owned-token"
        ))
        XCTAssertFalse(expected.matches(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            environment: "AGENT_SERVER_LAUNCH_TOKEN=other-token"
        ))
    }

    func testLaunchTokenMatchingDoesNotAcceptPrefixesOrDifferentVariables() {
        let identity = ServerProcessIdentity(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            launchToken: "owned-token"
        )

        XCTAssertFalse(identity.matches(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            environment: "NOT_AGENT_SERVER_LAUNCH_TOKEN=owned-token"
        ))
        XCTAssertFalse(identity.matches(
            pid: 42,
            executablePath: "/opt/homebrew/bin/node",
            environment: "AGENT_SERVER_LAUNCH_TOKEN=owned-token-extra"
        ))
    }

    func testShutdownPolicyEscalatesOnlyWhileTheSameOwnedProcessIsRunning() {
        XCTAssertEqual(
            ServerShutdownPolicy.nextAction(
                isRunning: false,
                identityMatches: false,
                hasSentTerminate: false
            ),
            .complete
        )
        XCTAssertEqual(
            ServerShutdownPolicy.nextAction(
                isRunning: true,
                identityMatches: true,
                hasSentTerminate: false
            ),
            .terminate
        )
        XCTAssertEqual(
            ServerShutdownPolicy.nextAction(
                isRunning: true,
                identityMatches: true,
                hasSentTerminate: true
            ),
            .kill
        )
        XCTAssertEqual(
            ServerShutdownPolicy.nextAction(
                isRunning: true,
                identityMatches: false,
                hasSentTerminate: true
            ),
            .identityMismatch
        )
    }

    func testLifecycleOnlyStopsProcessesStartedByThisApp() {
        var lifecycle = ServerProcessLifecycle()
        lifecycle.observedExistingServer()
        XCTAssertFalse(lifecycle.shouldStopProcess)

        lifecycle.didLaunchServer()
        XCTAssertTrue(lifecycle.shouldStopProcess)

        lifecycle.didStopServer()
        XCTAssertFalse(lifecycle.shouldStopProcess)

        lifecycle.didStopServer()
        XCTAssertFalse(lifecycle.shouldStopProcess)
    }
}
