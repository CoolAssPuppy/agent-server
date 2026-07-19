import Foundation

public enum RunTerminalObserver {
    public static func wait(
        fetch: () async -> Result<SafeTestRunState, ConsumerFlowFailure>,
        pause: () async -> Void = {
            try? await Task.sleep(for: .seconds(1))
        }
    ) async -> Result<SafeTestRunState, ConsumerFlowFailure> {
        while !Task.isCancelled {
            let result = await fetch()
            switch result {
            case .success(.running):
                await pause()
            case .success, .failure:
                return result
            }
        }
        return .success(.stopped)
    }
}
