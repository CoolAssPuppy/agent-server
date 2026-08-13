import Foundation

extension DemoModeFixtures {
    var presentedAgents: [Agent] {
        agents.map { fixture in
            Agent(
                id: fixture.id,
                name: fixture.name,
                description: fixture.description,
                schedule: fixture.schedule,
                prompt: fixture.prompt,
                tools: fixture.tools,
                maxTurns: 20,
                enabled: fixture.enabled,
                watch: nil,
                interaction: nil,
                notification: nil,
                onComplete: nil,
                onFailure: nil,
                disallowedTools: ["Bash"],
                timezone: fixture.timezone,
                model: nil,
                executor: "claude-code",
                provider: nil,
                connections: nil,
                skills: nil,
                runtimeSource: .legacyFrontmatter,
                runtimeRevision: nil,
                timeout: "30m",
                permissionMode: "default",
                workingDirectory: fixture.workingDirectory,
                rerunPolicy: nil,
                capabilities: nil
            )
        }
    }

    var presentedRuns: [Run] {
        runs.map { fixture in
            Run(
                runId: fixture.id,
                agentId: fixture.agentId,
                agentName: fixture.agentName,
                status: fixture.status.presentedStatus,
                startedAt: fixture.startedAt,
                completedAt: fixture.completedAt,
                summary: fixture.summary,
                error: fixture.error,
                turnCount: fixture.turnCount,
                toolsUsed: fixture.toolsUsed,
                filesRead: fixture.filesRead,
                filesWritten: fixture.filesWritten,
                commandsRun: [],
                progressMessages: fixture.progressMessages,
                accomplishments: fixture.accomplishments,
                observations: fixture.observations,
                trigger: fixture.trigger,
                model: "Claude Sonnet",
                inputTokens: nil,
                outputTokens: nil,
                estimatedCostUsd: nil,
                durationMs: fixture.durationMs,
                conversationId: nil
            )
        }
    }
}

private extension DemoRunStatus {
    var presentedStatus: RunStatus {
        switch self {
        case .running: .running
        case .completed: .completed
        case .failed: .failed
        }
    }
}
