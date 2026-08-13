import type { AgentLogger } from './logger.js';

/**
 * What a log tool needs to know about the run it is writing for.
 *
 * This lives apart from the tools themselves because both of them need it and
 * each of them needs the other: `log-tool.ts` builds the read tool into its
 * server, and the read tool takes this context. Holding the shared type here
 * keeps that from being a cycle.
 */
export type LogToolContext = {
  logger: AgentLogger;
  agentId: string;
  runId: string;
};
