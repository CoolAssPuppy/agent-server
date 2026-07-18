import type { AgentConfig } from '../agents/config.js';
import type { DiagnosticResult } from '../analysis/models.js';
import type { StoredRun } from '../reporting/store.js';

export type DiagnosticReadiness = {
  serverOnline: boolean;
  runtimeAvailable: boolean;
  workingDirectoryExists: boolean;
  runAlreadyActive?: boolean;
  agentParseError?: string;
  invalidSchedule?: boolean;
  missingConnections?: string[];
  missingEnvironmentVariables?: string[];
  networkRequired?: boolean;
  notificationReady?: boolean;
  expectedOutputMissing?: string;
};

export type DiagnosticInput = {
  agent: AgentConfig;
  run: StoredRun;
  readiness: DiagnosticReadiness;
  model?: DiagnosticModel;
};

export type DiagnosticModel = {
  readonly handlesRetries?: boolean;
  generate: (
    prompt: string,
    outputSchema: Record<string, unknown>,
    options?: { requestKey?: string; signal?: AbortSignal },
  ) => Promise<unknown>;
};

export type DiagnosticRule = (input: DiagnosticInput) => DiagnosticResult | undefined;
