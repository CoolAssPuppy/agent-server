struct DecisionRefreshCoordinator {
    struct Token: Equatable {
        fileprivate let generation: Int
        fileprivate let sequence: Int
    }

    struct Completion: Equatable {
        let shouldApply: Bool
        let followUp: Token?
    }

    private var generation = 0
    private var nextSequence = 0
    private var activeToken: Token?
    private var isFollowUpRequested = false

    mutating func requestRefresh() -> Token? {
        guard activeToken == nil else {
            isFollowUpRequested = true
            return nil
        }
        return beginRefresh()
    }

    mutating func finishRefresh(_ token: Token) -> Completion {
        guard activeToken == token else {
            return Completion(shouldApply: false, followUp: nil)
        }

        activeToken = nil
        guard isFollowUpRequested else {
            return Completion(shouldApply: true, followUp: nil)
        }

        isFollowUpRequested = false
        return Completion(shouldApply: true, followUp: beginRefresh())
    }

    mutating func stop() {
        generation += 1
        activeToken = nil
        isFollowUpRequested = false
    }

    private mutating func beginRefresh() -> Token {
        nextSequence += 1
        let token = Token(generation: generation, sequence: nextSequence)
        activeToken = token
        return token
    }
}

struct DecisionResolutionTransaction {
    private var activeDecisionIds: Set<String> = []

    mutating func begin(decisionId: String) -> Bool {
        activeDecisionIds.insert(decisionId).inserted
    }

    mutating func finish(decisionId: String, succeeded: Bool) -> Bool {
        guard activeDecisionIds.remove(decisionId) != nil else { return false }
        return succeeded
    }
}
