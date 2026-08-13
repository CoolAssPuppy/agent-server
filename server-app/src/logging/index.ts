import { hostname } from 'node:os';
import { join } from 'node:path';
import type { LogDestination } from './destination.js';
import { AgentLogStore } from './log-store.js';
import { AgentLogger } from './logger.js';
import { PanelLogDestination } from './panel-log-destination.js';

export { AgentLogStore } from './log-store.js';
export { AgentLogger } from './logger.js';
export { PanelLogDestination } from './panel-log-destination.js';
export type { PanelLogDestinationOptions } from './panel-log-destination.js';
export type { AgentLoggerOptions } from './logger.js';
export { LogEntryTooLargeError, LOG_LEVELS } from './record.js';
export type { LogAppendInput, LogLevel, LogRecord, LogRunQuery, LogSource } from './record.js';
export type { LogDestination, ReadableLogDestination } from './destination.js';
export {
  AGENT_LOG_SERVER_NAME,
  AGENT_LOG_TOOL_NAME,
  createAgentLogMcpServer,
  writeAgentLog,
} from './log-tool.js';
export type { LogToolContext, LogToolInput } from './log-tool.js';
export { AGENT_LOG_READ_TOOL_NAME, readAgentLog } from './log-read-tool.js';

/**
 * Builds the logger from server configuration, with the local JSONL file as the
 * driver reads come back from. Extra drivers are appended here as they arrive.
 *
 * `machineId` is the paired identity when the panel knows this machine, so one
 * panel can tell logs from several machines apart; unpaired servers fall back to
 * the hostname.
 *
 * The panel driver needs all three of a URL, a credential, and a paired machine
 * id. An organization key names no machine, and Panel takes the row's machine
 * from the credential, so a server that has not paired keeps its logs local
 * rather than filing them against somebody else's Mac.
 */
export function createAgentLogger(config: {
  logsDir: string;
  machineId?: string;
  panelUrl?: string;
  panelApiKey?: string;
  fetchImpl?: typeof globalThis.fetch;
}): AgentLogger {
  const host = hostname();
  const destinations: LogDestination[] = [];

  if (config.panelUrl && config.panelApiKey && config.machineId) {
    destinations.push(new PanelLogDestination({
      panelUrl: config.panelUrl,
      panelApiKey: config.panelApiKey,
      machineId: config.machineId,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    }));
  }

  return new AgentLogger({
    readsFrom: new AgentLogStore({ root: join(config.logsDir, 'agents') }),
    destinations,
    machineId: config.machineId ?? host,
    hostname: host,
  });
}
