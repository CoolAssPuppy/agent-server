import Foundation

public enum CreationConnectionStepCopy {
    public static let title = "Set up the connections your agent needs"
    public static let explanation = "This helps your agent get and send data to the right place."
}

public enum CreationFileAccessStepCopy {
    public static let explanation = "You choose exactly what your agent can access on this Mac."
}

public enum UnsupportedCreationServiceClassifier {
    private static let aliases: [(id: String, terms: [String])] = [
        ("airtable", ["airtable"]),
        ("asana", ["asana"]),
        ("discord", ["discord"]),
        ("dropbox", ["dropbox"]),
        ("hubspot", ["hubspot"]),
        ("jira", ["jira"]),
        ("microsoft_teams", ["microsoft teams", "ms teams"]),
        ("salesforce", ["salesforce"]),
        ("todoist", ["todoist"]),
        ("trello", ["trello"]),
        ("zapier", ["zapier"]),
    ]

    public static func serviceIDs(in request: String) -> [String] {
        aliases.compactMap { entry in
            entry.terms.contains(where: { contains(term: $0, in: request) }) ? entry.id : nil
        }.sorted()
    }

    private static func contains(term: String, in request: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: term)
        return request.range(of: "\\b\(escaped)\\b", options: [.regularExpression, .caseInsensitive]) != nil
    }
}

public struct UnsupportedServiceTelemetryTracker: Equatable, Sendable {
    private var recordedIDs: Set<String> = []

    public init() {}

    public mutating func newServiceIDs(from serviceIDs: [String]) -> [String] {
        let fresh = serviceIDs.filter { recordedIDs.insert($0).inserted }
        return fresh.sorted()
    }
}
