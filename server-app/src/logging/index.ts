import { hostname } from 'node:os';
import { join } from 'node:path';
import { AgentLogStore } from './log-store.js';

export { AgentLogStore, LogEntryTooLargeError, LOG_LEVELS } from './log-store.js';
export type { LogAppendInput, LogLevel, LogRecord } from './log-store.js';
export {
  AGENT_LOG_SERVER_NAME,
  AGENT_LOG_TOOL_NAME,
  createAgentLogMcpServer,
  writeAgentLog,
} from './log-tool.js';
export type { LogToolContext, LogToolInput } from './log-tool.js';
export { AGENT_LOG_READ_TOOL_NAME, readAgentLog } from './log-read-tool.js';

/**
 * Builds the log store from server configuration. `machineId` is the paired
 * identity when the panel knows this machine, so one panel can tell logs from
 * several machines apart; unpaired servers fall back to the hostname.
 */
export function createAgentLogStore(config: {
  logsDir: string;
  machineId?: string;
}): AgentLogStore {
  const host = hostname();
  return new AgentLogStore({
    root: join(config.logsDir, 'agents'),
    machineId: config.machineId ?? host,
    hostname: host,
  });
}
