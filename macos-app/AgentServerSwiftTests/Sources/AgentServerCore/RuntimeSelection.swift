public struct RuntimeSelection: Equatable, Sendable {
    public let usesInstalledClaude: Bool
    public let usesInstalledCodex: Bool

    public init(usesInstalledClaude: Bool, usesInstalledCodex: Bool) {
        self.usesInstalledClaude = usesInstalledClaude
        self.usesInstalledCodex = usesInstalledCodex
    }

    public func requiresRestart(comparedTo saved: RuntimeSelection) -> Bool {
        self != saved
    }
}
