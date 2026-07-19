import Foundation

public struct DemoModeState: Equatable {
    public let isEnabled: Bool

    public init(isEnabled: Bool) {
        self.isEnabled = isEnabled
    }

    public var contextMenuTitle: String {
        isEnabled ? "Disable Demo Mode" : "Enable Demo Mode"
    }
}

public struct DemoModePreference {
    private static let key = "screenshotDemoMode.enabled"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isEnabled: Bool {
        defaults.bool(forKey: Self.key)
    }

    public func setEnabled(_ isEnabled: Bool) {
        defaults.set(isEnabled, forKey: Self.key)
    }
}

public struct DemoAgentFixture: Equatable, Identifiable {
    public let id: String
    public let name: String
    public let description: String
    public let schedule: String?
    public let prompt: String
    public let tools: [String]
    public let enabled: Bool
    public let timezone: String
    public let workingDirectory: String?

    public init(
        id: String,
        name: String,
        description: String,
        schedule: String?,
        prompt: String,
        tools: [String],
        enabled: Bool = true,
        timezone: String = "Europe/Lisbon",
        workingDirectory: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.schedule = schedule
        self.prompt = prompt
        self.tools = tools
        self.enabled = enabled
        self.timezone = timezone
        self.workingDirectory = workingDirectory
    }
}

public enum DemoRunStatus: String, Equatable {
    case running
    case completed
    case failed
}

public struct DemoRunFixture: Equatable, Identifiable {
    public let id: String
    public let agentId: String
    public let agentName: String
    public let status: DemoRunStatus
    public let startedAt: Date
    public let completedAt: Date?
    public let summary: String?
    public let error: String?
    public let turnCount: Int
    public let toolsUsed: [String]
    public let filesRead: [String]
    public let filesWritten: [String]
    public let progressMessages: [String]
    public let accomplishments: [String]
    public let observations: [String]
    public let trigger: String
    public let durationMs: Int?

    public init(
        id: String,
        agentId: String,
        agentName: String,
        status: DemoRunStatus,
        startedAt: Date,
        completedAt: Date?,
        summary: String?,
        error: String? = nil,
        turnCount: Int,
        toolsUsed: [String],
        filesRead: [String] = [],
        filesWritten: [String] = [],
        progressMessages: [String] = [],
        accomplishments: [String] = [],
        observations: [String] = [],
        trigger: String = "schedule",
        durationMs: Int? = nil
    ) {
        self.id = id
        self.agentId = agentId
        self.agentName = agentName
        self.status = status
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.summary = summary
        self.error = error
        self.turnCount = turnCount
        self.toolsUsed = toolsUsed
        self.filesRead = filesRead
        self.filesWritten = filesWritten
        self.progressMessages = progressMessages
        self.accomplishments = accomplishments
        self.observations = observations
        self.trigger = trigger
        self.durationMs = durationMs
    }
}

public struct DemoModeFixtures: Equatable {
    public let agents: [DemoAgentFixture]
    public let runs: [DemoRunFixture]

    public func runs(for agentId: String) -> [DemoRunFixture] {
        runs.filter { $0.agentId == agentId }
    }

    public static func make(referenceDate: Date) -> Self {
        let agents = makeAgents()
        return Self(agents: agents, runs: makeRuns(referenceDate: referenceDate))
    }

    private static func makeAgents() -> [DemoAgentFixture] {
        [
            DemoAgentFixture(
                id: "demo-morning-briefing",
                name: "Morning briefing",
                description: "Prepares a calm summary of today's calendar, priorities, and weather.",
                schedule: "0 7 * * 1-5",
                prompt: "Prepare my morning briefing. Keep it concise and useful.",
                tools: ["mcp__eventkit__list_events", "WebSearch"]
            ),
            DemoAgentFixture(
                id: "demo-manuscript-review",
                name: "Manuscript review",
                description: "Checks the latest chapter against the series bible and saves editorial notes.",
                schedule: "0 3 * * *",
                prompt: "Review the manuscript against the series bible and outline.",
                tools: ["Read", "mcp__notion__create_page"],
                workingDirectory: "~/Documents/Age of the Astronomer"
            ),
            DemoAgentFixture(
                id: "demo-github-summary",
                name: "Friday GitHub summary",
                description: "Sends a short weekly summary of shipped work to the team.",
                schedule: "0 17 * * 5",
                prompt: "Summarize this week's GitHub activity and send it to Slack.",
                tools: ["mcp__github__list_commits", "mcp__slack__send_message"]
            ),
            DemoAgentFixture(
                id: "demo-language-practice",
                name: "Daily language practice",
                description: "Creates a quick Portuguese and French practice session each morning.",
                schedule: "0 6 * * *",
                prompt: "Create today's Portuguese and French practice session.",
                tools: ["WebSearch"]
            ),
            DemoAgentFixture(
                id: "demo-cmo-coach",
                name: "CMO coaching report",
                description: "Turns weekly notes into focused coaching questions and follow-ups.",
                schedule: "0 9 * * 6",
                prompt: "Prepare this week's CMO coaching report.",
                tools: ["Read", "mcp__notion__search"]
            ),
            DemoAgentFixture(
                id: "demo-inbox-follow-up",
                name: "Inbox follow-up",
                description: "Finds messages that need a reply and drafts a private follow-up list.",
                schedule: "30 8 * * 1-5",
                prompt: "Find messages that need a reply. Draft suggestions but do not send them.",
                tools: ["mcp__gmail__search", "mcp__gmail__read"]
            )
        ]
    }

    private static func makeRuns(referenceDate: Date) -> [DemoRunFixture] {
        let hour: (Double) -> Date = { referenceDate.addingTimeInterval(-$0 * 3_600) }
        return [
            DemoRunFixture(
                id: "demo-run-briefing-current",
                agentId: "demo-morning-briefing",
                agentName: "Morning briefing",
                status: .running,
                startedAt: hour(0.08),
                completedAt: nil,
                summary: nil,
                turnCount: 3,
                toolsUsed: ["Calendar", "Weather"],
                progressMessages: ["Checking today's calendar", "Preparing your briefing"]
            ),
            DemoRunFixture(
                id: "demo-run-language",
                agentId: "demo-language-practice",
                agentName: "Daily language practice",
                status: .completed,
                startedAt: hour(1.5),
                completedAt: hour(1.46),
                summary: "Prepared a 10-minute lesson on travel phrases and past-tense verbs.",
                turnCount: 5,
                toolsUsed: ["Web search"],
                accomplishments: ["Created Portuguese practice", "Created French practice"],
                durationMs: 144_000
            ),
            DemoRunFixture(
                id: "demo-run-inbox",
                agentId: "demo-inbox-follow-up",
                agentName: "Inbox follow-up",
                status: .completed,
                startedAt: hour(4),
                completedAt: hour(3.95),
                summary: "Found four messages that may need a reply and drafted a private follow-up list.",
                turnCount: 7,
                toolsUsed: ["Gmail"],
                accomplishments: ["Reviewed 18 recent messages", "Flagged four follow-ups"],
                durationMs: 180_000
            ),
            DemoRunFixture(
                id: "demo-run-manuscript",
                agentId: "demo-manuscript-review",
                agentName: "Manuscript review",
                status: .completed,
                startedAt: hour(8),
                completedAt: hour(7.8),
                summary: "Reviewed Chapter 14 and saved seven development notes to Notion.",
                turnCount: 12,
                toolsUsed: ["Files", "Notion"],
                filesRead: ["~/Documents/Age of the Astronomer/Chapter 14.docx"],
                accomplishments: ["Checked characterization", "Compared the chapter with the outline", "Saved editorial notes"],
                observations: ["One scene conflicts with the established timeline"],
                durationMs: 720_000
            ),
            DemoRunFixture(
                id: "demo-run-github",
                agentId: "demo-github-summary",
                agentName: "Friday GitHub summary",
                status: .completed,
                startedAt: hour(26),
                completedAt: hour(25.9),
                summary: "Sent a concise summary of 12 merged changes to the team Slack channel.",
                turnCount: 8,
                toolsUsed: ["GitHub", "Slack"],
                accomplishments: ["Reviewed 12 merged changes", "Sent the weekly summary"],
                durationMs: 360_000
            ),
            DemoRunFixture(
                id: "demo-run-cmo",
                agentId: "demo-cmo-coach",
                agentName: "CMO coaching report",
                status: .completed,
                startedAt: hour(52),
                completedAt: hour(51.9),
                summary: "Prepared five coaching questions and three follow-up themes.",
                turnCount: 6,
                toolsUsed: ["Files", "Notion"],
                durationMs: 300_000
            ),
            DemoRunFixture(
                id: "demo-run-briefing-old",
                agentId: "demo-morning-briefing",
                agentName: "Morning briefing",
                status: .completed,
                startedAt: hour(72),
                completedAt: hour(71.96),
                summary: "Prepared the morning briefing with three meetings and two priorities.",
                turnCount: 4,
                toolsUsed: ["Calendar", "Weather"],
                durationMs: 150_000
            ),
            DemoRunFixture(
                id: "demo-run-inbox-failed",
                agentId: "demo-inbox-follow-up",
                agentName: "Inbox follow-up",
                status: .failed,
                startedAt: hour(96),
                completedAt: hour(95.98),
                summary: nil,
                error: "Gmail needs to be connected again.",
                turnCount: 2,
                toolsUsed: ["Gmail"],
                observations: ["No messages were changed or sent"],
                durationMs: 72_000
            )
        ]
    }
}
