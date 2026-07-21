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
    struct Token: Equatable {
        let decisionId: String
        fileprivate let generation: Int
        fileprivate let sequence: Int
    }

    private var generation = 0
    private var nextSequence = 0
    private var activeTokens: [String: Token] = [:]

    mutating func begin(decisionId: String) -> Token? {
        guard activeTokens[decisionId] == nil else { return nil }
        nextSequence += 1
        let token = Token(
            decisionId: decisionId,
            generation: generation,
            sequence: nextSequence
        )
        activeTokens[decisionId] = token
        return token
    }

    mutating func finish(_ token: Token, succeeded: Bool) -> Bool? {
        guard activeTokens[token.decisionId] == token else { return nil }
        activeTokens[token.decisionId] = nil
        return succeeded
    }

    mutating func cancelAll() {
        generation += 1
        activeTokens.removeAll()
    }
}
