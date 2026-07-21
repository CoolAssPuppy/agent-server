public struct RuntimeSelection: Equatable, Sendable {
    public let usesInstalledKimi: Bool

    public init(usesInstalledKimi: Bool) {
        self.usesInstalledKimi = usesInstalledKimi
    }

    public func requiresRestart(comparedTo saved: RuntimeSelection) -> Bool {
        self != saved
    }
}
