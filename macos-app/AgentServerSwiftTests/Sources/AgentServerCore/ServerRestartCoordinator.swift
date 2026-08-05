import Foundation

public enum LocalServerLifecycleState: Equatable, Sendable {
    case unavailable
    case running(startedAt: String?)
    case pending(activeRunCount: Int)
    case restarting(previousStartedAt: String?)
    case failed(message: String)
}

public struct LocalServerLifecyclePresentation: Equatable, Sendable {
    public let label: String
    public let isHealthy: Bool

    public init(state: LocalServerLifecycleState) {
        switch state {
        case .running:
            label = "Running"
            isHealthy = true
        case .pending:
            label = "Restart pending"
            isHealthy = true
        case .restarting:
            label = "Restarting"
            isHealthy = false
        case .failed:
            label = "Restart failed"
            isHealthy = false
        case .unavailable:
            label = "Offline"
            isHealthy = false
        }
    }
}

public struct ServerRestartCoordinator: Equatable, Sendable {
    public private(set) var state: LocalServerLifecycleState = .unavailable

    private let requiredAPIVersion: Int
    private var requestedGeneration = 0
    private var appliedGeneration = 0
    private var restartingGeneration: Int?
    private var lastStartedAt: String?

    public init(requiredAPIVersion: Int = 12) {
        self.requiredAPIVersion = requiredAPIVersion
    }

    public mutating func observeRunning(startedAt: String?) {
        lastStartedAt = startedAt
        guard requestedGeneration == appliedGeneration else { return }
        state = .running(startedAt: startedAt)
    }

    public mutating func requestRestart(activeRunCount: Int) -> Bool {
        requestedGeneration &+= 1
        guard restartingGeneration == nil else { return false }
        guard activeRunCount == 0 else {
            state = .pending(activeRunCount: activeRunCount)
            return false
        }
        beginRestart()
        return true
    }

    public mutating func activeRunCountChanged(to count: Int) -> Bool {
        guard requestedGeneration > appliedGeneration, restartingGeneration == nil else {
            return false
        }
        guard count == 0 else {
            state = .pending(activeRunCount: count)
            return false
        }
        beginRestart()
        return true
    }

    public mutating func observeRestartHealth(startedAt: String?, apiVersion: Int) -> Bool {
        guard let generation = restartingGeneration,
              apiVersion == requiredAPIVersion,
              let startedAt,
              startedAt != lastStartedAt else {
            return false
        }

        lastStartedAt = startedAt
        appliedGeneration = generation
        restartingGeneration = nil
        if requestedGeneration > appliedGeneration {
            beginRestart()
            return false
        }
        state = .running(startedAt: startedAt)
        return true
    }

    public mutating func restartFailed(message: String) {
        restartingGeneration = nil
        state = .failed(message: message)
    }

    public mutating func retry(activeRunCount: Int) -> Bool {
        if requestedGeneration == appliedGeneration {
            requestedGeneration &+= 1
        }
        guard activeRunCount == 0 else {
            state = .pending(activeRunCount: activeRunCount)
            return false
        }
        beginRestart()
        return true
    }

    private mutating func beginRestart() {
        restartingGeneration = requestedGeneration
        state = .restarting(previousStartedAt: lastStartedAt)
    }
}
