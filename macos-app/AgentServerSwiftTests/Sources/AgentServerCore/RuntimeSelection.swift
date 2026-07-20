public struct RuntimeSelection: Equatable, Sendable {
    public let usesInstalledClaude: Bool
    public let usesInstalledCodex: Bool
    public let usesInstalledKimi: Bool

    public init(
        usesInstalledClaude: Bool,
        usesInstalledCodex: Bool,
        usesInstalledKimi: Bool
    ) {
        self.usesInstalledClaude = usesInstalledClaude
        self.usesInstalledCodex = usesInstalledCodex
        self.usesInstalledKimi = usesInstalledKimi
    }

    public func requiresRestart(comparedTo saved: RuntimeSelection) -> Bool {
        self != saved
    }
}
