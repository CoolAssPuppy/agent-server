import type { AgentConfig } from '../agents/config.js';
import type { StoredRun } from '../reporting/store.js';
import { sanitizeStructuredValue, sanitizeText } from '../server/security-utils.js';
import type { DiagnosticReadiness } from './diagnostic-types.js';

type PromptInput = {
  agent: AgentConfig;
  run: StoredRun;
  readiness: DiagnosticReadiness;
};

const SYSTEM_INSTRUCTIONS = `Explain an Agent Server run failure in plain language.
Return only a value matching the supplied JSON schema.
Use only the evidence in the diagnostic package.
Do not invent evidence, logs, tool calls, settings, or certainty.
Separate the most likely cause from alternative explanations.
Recommend the narrowest fix and state its safety impact.
Do not recommend unrestricted file access, arbitrary command execution, or transmitting credentials.
Set can_automate to false for any change that broadens file, command, network, or messaging access.`;

/** Build a bounded diagnostic package without agent instructions or tool payloads. */
export function buildDiagnosticPrompt(input: PromptInput): string {
  const diagnosticPackage = sanitizeStructuredValue({
    run: {
      id: input.run.runId,
      status: input.run.status,
      error: input.run.error,
      progress: input.run.progressMessages.slice(-20),
      tools_used: input.run.toolsUsed,
      files_read: input.run.filesRead.slice(-20),
      files_written: input.run.filesWritten.slice(-20),
      commands_run: input.run.commandsRun.slice(-10),
    },
    configuration: {
      agent_id: input.agent.id,
      executor: input.agent.executor ?? 'claude-code',
      model: input.agent.model ?? 'default',
      working_directory: input.agent.working_directory ?? 'home folder',
      schedule: input.agent.schedule ?? 'manual',
      tools: input.agent.tools,
      denied_tools: input.agent.disallowed_tools,
      sandbox: input.agent.codex_sandbox,
      has_connections: Object.keys(input.agent.mcp_servers ?? {}).length > 0,
      notification_channel: input.agent.notification?.channel,
    },
    readiness: input.readiness,
  });
  return `${SYSTEM_INSTRUCTIONS}\n\nDiagnostic package:\n${sanitizeText(JSON.stringify(diagnosticPackage), 12_000)}`;
}
