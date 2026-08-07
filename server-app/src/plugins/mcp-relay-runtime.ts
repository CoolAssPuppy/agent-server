import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { runtimeConnectionPolicy } from '../connections/runtime-policy.js';
import type { CredentialBrokerPlan } from './credential-broker.js';

export type McpPolicyRelayCommand = {
  command: string;
  args: string[];
};

/** Builds a secret-free command that gives one saved connection an exact run policy. */
export function buildMcpPolicyRelayCommand(
  agent: AgentConfig,
  runtimeName: string,
  config: McpServerConfig,
  credentials: Record<string, string>,
  credentialBroker: CredentialBrokerPlan,
): McpPolicyRelayCommand | undefined {
  const policy = runtimeConnectionPolicy(agent, runtimeName);
  if (!policy) return undefined;
  const transport = 'command' in config
    ? { kind: 'stdio' as const, command: config.command, args: config.args ?? [] }
    : { kind: config.type, url: config.url };
  const grant = Object.keys(credentials).length > 0 ? randomUUID() : undefined;
  if (grant) credentialBroker.grants[grant] = credentials;
  const payload = {
    transport,
    policy,
    ...(grant ? {
      credential_broker: credentialBroker.socketPath,
      credential_grant: grant,
    } : {}),
  };
  return {
    command: process.execPath,
    args: [
      fileURLToPath(new URL('./mcp-policy-relay.js', import.meta.url)),
      JSON.stringify(payload),
    ],
  };
}
