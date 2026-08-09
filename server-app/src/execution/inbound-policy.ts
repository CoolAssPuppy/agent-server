import type { AgentConfig } from '../agents/config.js';

/**
 * The rule that governs externally triggered runs.
 *
 * > An inbound-triggered run may not use an agent that can write to the source
 * > that triggered it.
 *
 * The payload of an inbound trigger is written by whoever filed the issue or
 * sent the message. An agent that reads Linear and writes a private Notion page
 * is safe to point at that payload. An agent that can comment back on the
 * issue is not, because the person who wrote the payload would then be steering
 * what gets said in their own thread.
 *
 * This check lives on the machine rather than in Panel because Panel never
 * receives agent permissions. `buildV2AssistantSyncPayload` is deliberately
 * limited to operational fields, and sending tool policy upstream to render a
 * warning would trade a real privacy property for a cosmetic one.
 *
 * A refusal names the exact deny entries that would make the agent eligible, so
 * the fix is mechanical rather than a guess.
 */

export type InboundSource = 'linear' | 'slack' | 'notion' | 'generic';

/**
 * Per source: how to recognise its tools at all, and the operation families
 * that write. A family is a prefix, matched against the operation part of an
 * MCP tool name, so one deny entry covers every tool in it.
 */
const SOURCE_POLICY: Record<Exclude<InboundSource, 'generic'>, {
  server: RegExp;
  writeFamilies: readonly string[];
}> = {
  linear: {
    server: /linear/i,
    writeFamilies: ['save', 'create', 'update', 'delete', 'merge', 'submit', 'resolve'],
  },
  slack: {
    server: /slack/i,
    writeFamilies: ['slack_send', 'slack_schedule', 'slack_create', 'slack_update', 'slack_add'],
  },
  notion: {
    server: /notion/i,
    writeFamilies: ['notion-create', 'notion-update', 'notion-move', 'notion-duplicate', 'notion-delete'],
  },
};

export type InboundVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

function grantedPatterns(agent: AgentConfig): string[] {
  return [...(agent.tools ?? []), ...(agent.permissions?.allow ?? [])];
}

function touchesServer(agent: AgentConfig, server: RegExp): boolean {
  return grantedPatterns(agent).some((pattern) => server.test(pattern));
}

/**
 * A deny entry covers a family only when it is at least as broad as the family.
 *
 * `mcp__claude_ai_Linear__save_*` covers `save`, and a bare
 * `mcp__claude_ai_Linear` covers everything on that server. A narrower entry
 * does not: denying `save_comment` leaves `save_issue` allowed, so treating it
 * as cover for the whole `save` family would clear an agent that can still
 * write back. The check runs one way round for that reason.
 */
function isFamilyDenied(denies: readonly string[], server: RegExp, family: string): boolean {
  return denies.some((entry) => {
    if (!server.test(entry)) return false;

    const operation = entry.split('__').slice(2).join('__');
    // No operation part means the deny covers the whole server.
    if (!operation) return true;

    // `save_*` and `save*` both mean the save family. The trailing separator
    // goes with the wildcard so the comparison below can be a prefix test.
    const stem = operation.replace(/\*+$/, '').replace(/[._-]+$/, '');
    return stem.length > 0 && family.startsWith(stem);
  });
}

/**
 * Decides whether `agent` may run because `source` asked for it.
 *
 * An agent with no access to the source at all is allowed: it cannot write
 * back to something it cannot reach. An agent that can reach the source must
 * deny every write family before it is eligible.
 */
export function canRunFromInbound(agent: AgentConfig, source: string): InboundVerdict {
  const policy = SOURCE_POLICY[source as Exclude<InboundSource, 'generic'>];

  // An unrecognized source has no known write surface to check, so nothing can
  // be proven about it. Refusing is the only safe answer.
  if (!policy) {
    return {
      allowed: false,
      reason: `Inbound source "${source}" has no write policy, so no agent can be cleared to run from it`,
    };
  }

  if (!touchesServer(agent, policy.server)) return { allowed: true };

  const denies = agent.permissions?.deny ?? [];
  const missing = policy.writeFamilies.filter(
    (family) => !isFamilyDenied(denies, policy.server, family),
  );

  if (missing.length === 0) return { allowed: true };

  return {
    allowed: false,
    reason:
      `${agent.name} can write to ${source}, so it may not be started by a ${source} event. `
      + `Add these to its permissions.deny: ${missing.map((family) => `${family}_*`).join(', ')}`,
  };
}
