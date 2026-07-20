import type { McpServerConfig } from '../agents/config.js';
import { parseAgentFile } from '../agents/config.js';
import {
  ConfigurationPatchSchema,
  type ConfigurationPatch,
} from '../analysis/patch.js';
import { computeAgentContentHash } from '../analysis/security-rules.js';
import type { ConnectionProfile } from './profile.js';
import { resolveConnectionProfile } from './profile-resolver.js';
import { stableValue } from '../util/stable-value.js';

export type InlineAgentSource = {
  content: string;
  agent_id?: string;
};

export type ConnectionAdoptionBinding = {
  runtime_name: string;
  connection_id: string;
};

export type ConnectionAdoptionProposal = {
  agent_id: string;
  bindings: ConnectionAdoptionBinding[];
  patch: ConfigurationPatch;
};

export type ConnectionAdoptionRefusal = {
  agent_id: string;
  runtime_name: string;
  reason: 'no_exact_match' | 'ambiguous_match' | 'invalid_agent';
  candidate_connection_ids: string[];
};

export type ConnectionAdoptionPlan = {
  proposals: ConnectionAdoptionProposal[];
  refusals: ConnectionAdoptionRefusal[];
};

type ResolvedCandidate = {
  connection_id: string;
  runtime_name: string;
  config: McpServerConfig;
};

function normalizedConfig(config: McpServerConfig): Record<string, unknown> {
  if ('command' in config) {
    return {
      type: 'stdio',
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
    };
  }
  return {
    type: config.type,
    url: config.url,
    headers: config.headers ?? {},
  };
}

function exactlyMatches(left: McpServerConfig, right: McpServerConfig): boolean {
  return JSON.stringify(stableValue(normalizedConfig(left)))
    === JSON.stringify(stableValue(normalizedConfig(right)));
}

function resolvedCandidates(profiles: readonly ConnectionProfile[]): ResolvedCandidate[] {
  return profiles.flatMap((profile) => {
    try {
      const resolved = resolveConnectionProfile(profile);
      return [{
        connection_id: profile.id,
        runtime_name: resolved.serverName,
        config: resolved.config,
      }];
    } catch {
      return [];
    }
  });
}

function adoptionPatch(
  agentId: string,
  content: string,
  bindings: Record<string, string>,
): ConfigurationPatch {
  return ConfigurationPatchSchema.parse({
    schema_version: 1,
    agent_id: agentId,
    expected_content_hash: computeAgentContentHash(content),
    source: 'user',
    reason: 'Use reviewed saved connections without changing this agent’s access',
    changes: { connection_bindings: bindings },
  });
}

/**
 * Plans conservative adoption of inline MCP configurations into saved
 * connection profiles. A profile is eligible only when both its stable runtime
 * identity and its fully resolved transport, including environment references,
 * exactly match. The planner never selects between equivalent profiles.
 */
export function planInlineConnectionAdoption(
  sources: readonly InlineAgentSource[],
  profiles: readonly ConnectionProfile[],
): ConnectionAdoptionPlan {
  const candidates = resolvedCandidates(profiles);
  const proposals: ConnectionAdoptionProposal[] = [];
  const refusals: ConnectionAdoptionRefusal[] = [];

  for (const source of sources) {
    let agent;
    try {
      agent = parseAgentFile(source.content);
    } catch {
      refusals.push({
        agent_id: source.agent_id ?? 'unknown',
        runtime_name: '',
        reason: 'invalid_agent',
        candidate_connection_ids: [],
      });
      continue;
    }

    const bindings: ConnectionAdoptionBinding[] = [];
    const connectionBindings: Record<string, string> = { ...(agent.connection_bindings ?? {}) };

    for (const [runtimeName, inlineConfig] of Object.entries(agent.mcp_servers ?? {})) {
      if (agent.connection_bindings?.[runtimeName]) continue;
      const runtimeCandidates = candidates
        .filter((candidate) => candidate.runtime_name === runtimeName);
      if (runtimeCandidates.length === 0) continue;
      const matches = runtimeCandidates
        .filter((candidate) => exactlyMatches(candidate.config, inlineConfig))
        .sort((left, right) => left.connection_id.localeCompare(right.connection_id));

      if (matches.length !== 1) {
        refusals.push({
          agent_id: agent.id,
          runtime_name: runtimeName,
          reason: matches.length === 0 ? 'no_exact_match' : 'ambiguous_match',
          candidate_connection_ids: matches.map(({ connection_id: id }) => id),
        });
        continue;
      }

      const [{ connection_id: connectionId }] = matches;
      bindings.push({ runtime_name: runtimeName, connection_id: connectionId });
      connectionBindings[runtimeName] = connectionId;
    }

    if (bindings.length > 0) {
      proposals.push({
        agent_id: agent.id,
        bindings,
        patch: adoptionPatch(agent.id, source.content, connectionBindings),
      });
    }
  }

  return { proposals, refusals };
}
