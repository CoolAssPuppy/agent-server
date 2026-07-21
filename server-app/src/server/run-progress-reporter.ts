import type { McpServerInfo } from '../execution/executor.js';
import type { AgentConfig } from '../agents/config.js';
import { mcpServerKey } from '../agents/capabilities.js';
import { matchesPattern } from '../execution/permissions.js';
import type { Reporter } from '../execution/runner.js';
import type { RunStoreLike } from '../reporting/store.js';
import type { ProgressBroadcaster } from './websocket.js';

type RunProgressReporterDependencies = {
  runId: string;
  agentId: string;
  agent: AgentConfig;
  store: RunStoreLike;
  broadcaster: ProgressBroadcaster;
  reporter: Reporter;
};

function isNeedsAuthMcpServer(value: unknown): value is McpServerInfo {
  if (typeof value !== 'object' || value === null) return false;
  const server = value as Partial<McpServerInfo>;
  return server.status === 'needs-auth' && typeof server.name === 'string';
}

export function extractMcpNeedsAuthServers(meta: Record<string, unknown> | undefined): string[] {
  if (!meta || !Array.isArray(meta.mcp_servers)) return [];
  return meta.mcp_servers.filter(isNeedsAuthMcpServer).map((server) => server.name);
}

function mcpServerKeyFromToolRule(rule: string): string | undefined {
  const match = /^mcp__(.+?)(?:__|$)/.exec(rule);
  return match?.[1];
}

function toolRuleCoversServer(rule: string, serverKey: string): boolean {
  if (rule === '*') return true;
  const ruleKey = mcpServerKeyFromToolRule(rule);
  return ruleKey ? matchesPattern(serverKey, ruleKey) : false;
}

function isMcpServerRelevant(agent: AgentConfig, serverName: string): boolean {
  const serverKey = mcpServerKey(serverName);
  if (agent.permissions) {
    const isAllowed = agent.permissions.allow
      .some((rule) => toolRuleCoversServer(rule, serverKey));
    const isDenied = agent.permissions.deny
      .some((rule) => toolRuleCoversServer(rule, serverKey));
    return isAllowed && !isDenied;
  }

  const isDenied = agent.disallowed_tools
    .some((rule) => toolRuleCoversServer(rule, serverKey));
  if (isDenied) return false;
  return agent.tools.length === 0
    || agent.tools.some((rule) => toolRuleCoversServer(rule, serverKey));
}

export function extractRelevantMcpNeedsAuthServers(
  meta: Record<string, unknown> | undefined,
  agent: AgentConfig,
): string[] {
  return extractMcpNeedsAuthServers(meta)
    .filter((name) => isMcpServerRelevant(agent, name));
}

export function createRunProgressReporter(
  dependencies: RunProgressReporterDependencies,
): Reporter {
  let lastNeedsAuthKey: string | null = null;

  return {
    start: () => dependencies.reporter.start(),
    progress: (message, metadata) => {
      dependencies.store.addProgress(dependencies.runId, message);
      updateProgressMetadata(dependencies.store, dependencies.runId, metadata);
      dependencies.broadcaster.emit({
        type: 'run_progress',
        runId: dependencies.runId,
        agentId: dependencies.agentId,
        message,
        metadata,
        timestamp: new Date().toISOString(),
      });
      lastNeedsAuthKey = emitMcpStatus(dependencies, metadata, lastNeedsAuthKey);
      return dependencies.reporter.progress(message, metadata);
    },
    complete: (result) => dependencies.reporter.complete(result),
    fail: (error) => dependencies.reporter.fail(error),
    cancel: dependencies.reporter.cancel
      ? (reason, code) => dependencies.reporter.cancel?.(reason, code)
      : undefined,
    stop: () => dependencies.reporter.stop(),
  };
}

function updateProgressMetadata(
  store: RunStoreLike,
  runId: string,
  metadata?: Record<string, unknown>,
): void {
  if (!metadata) return;
  const rawTools = metadata.tools_used;
  const toolsUsed = Array.isArray(rawTools)
    ? rawTools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  store.update(runId, {
    turnCount: finiteNumber(metadata.turns_completed) ?? 0,
    toolsUsed,
  });
}

function emitMcpStatus(
  dependencies: RunProgressReporterDependencies,
  metadata: Record<string, unknown> | undefined,
  previousKey: string | null,
): string | null {
  const needsAuth = extractRelevantMcpNeedsAuthServers(metadata, dependencies.agent);
  if (needsAuth.length === 0) return previousKey;
  const key = [...needsAuth].sort().join('|');
  if (key === previousKey) return previousKey;
  dependencies.broadcaster.emit({
    type: 'mcp_status',
    runId: dependencies.runId,
    agentId: dependencies.agentId,
    mcp_needs_auth_servers: needsAuth,
    timestamp: new Date().toISOString(),
  });
  return key;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
