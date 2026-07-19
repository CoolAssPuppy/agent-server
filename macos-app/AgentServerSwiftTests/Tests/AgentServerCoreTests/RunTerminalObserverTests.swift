import XCTest
@testable import AgentServerCore

final class RunTerminalObserverTests: XCTestCase {
    func testWaitsThroughRunningUpdatesAndReturnsTheTerminalState() async {
        let states = RunStateSequence([.running, .running, .completed])

        let result = await RunTerminalObserver.wait(
            fetch: { await states.next() },
            pause: {}
        )

        XCTAssertEqual(try? result.get(), .completed)
        let requestCount = await states.requestCount
        XCTAssertEqual(requestCount, 3)
    }

    func testReturnsAStatusFailureWithoutPollingAgain() async {
        let failure = ConsumerFlowFailure(
            title: "Unavailable",
            message: "Could not check the run.",
            recovery: "Try again.",
            technicalDetails: "offline",
            didSave: true,
            canRetry: true
        )
        let states = RunStateSequence([], failure: failure)

        let result = await RunTerminalObserver.wait(fetch: { await states.next() }, pause: {})

        XCTAssertEqual(result, .failure(failure))
        let requestCount = await states.requestCount
        XCTAssertEqual(requestCount, 1)
    }
}

private actor RunStateSequence {
    private var states: [SafeTestRunState]
    private let failure: ConsumerFlowFailure?
    private(set) var requestCount = 0

    init(_ states: [SafeTestRunState], failure: ConsumerFlowFailure? = nil) {
        self.states = states
        self.failure = failure
    }

    func next() -> Result<SafeTestRunState, ConsumerFlowFailure> {
        requestCount += 1
        if let failure { return .failure(failure) }
        return .success(states.removeFirst())
    }
}
