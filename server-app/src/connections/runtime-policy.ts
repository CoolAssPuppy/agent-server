import type { AgentConfig } from '../agents/config.js';

export type PolicyValue = string | number | boolean;

export type RuntimeConnectionPolicy = Readonly<{
  allowedTools: readonly string[];
  argumentConstraints: Readonly<
    Record<string, Readonly<Record<string, readonly PolicyValue[]>>>
  >;
}>;

export type RuntimePortableOperationEvidence = Readonly<{
  use: string;
  operation: string;
  targets: readonly Readonly<{
    key: string;
    argument: string;
    value: PolicyValue;
  }>[];
}>;

export type RuntimeCodexAppPolicy = Readonly<{
  availableTools: readonly string[];
  tools: Readonly<Record<string, Readonly<{ effect: 'read' | 'write' }>>>;
}>;

const RUNTIME_CONNECTION_POLICIES = Symbol('runtime-connection-policies');
const RUNTIME_PORTABLE_EVIDENCE = Symbol('runtime-portable-evidence');
const RUNTIME_CODEX_APP_POLICIES = Symbol('runtime-codex-app-policies');

type AgentWithRuntimePolicies = AgentConfig & {
  [RUNTIME_CONNECTION_POLICIES]?: Readonly<Record<string, RuntimeConnectionPolicy>>;
  [RUNTIME_PORTABLE_EVIDENCE]?: Readonly<
    Record<string, readonly RuntimePortableOperationEvidence[]>
  >;
  [RUNTIME_CODEX_APP_POLICIES]?: Readonly<Record<string, RuntimeCodexAppPolicy>>;
};

/** Adds run-only policy metadata without exposing local IDs through serialized agent data. */
export function attachRuntimeConnectionPolicies(
  agent: AgentConfig,
  policies: Readonly<Record<string, RuntimeConnectionPolicy>>,
): void {
  Object.defineProperty(agent, RUNTIME_CONNECTION_POLICIES, {
    value: policies,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function runtimeConnectionPolicies(
  agent: AgentConfig,
): Readonly<Record<string, RuntimeConnectionPolicy>> {
  return (agent as AgentWithRuntimePolicies)[RUNTIME_CONNECTION_POLICIES] ?? {};
}

export function runtimeConnectionPolicy(
  agent: AgentConfig,
  runtimeName: string,
): RuntimeConnectionPolicy | undefined {
  return runtimeConnectionPolicies(agent)[runtimeName];
}

export function attachRuntimePortableEvidence(
  agent: AgentConfig,
  evidence: Readonly<Record<string, readonly RuntimePortableOperationEvidence[]>>,
): void {
  Object.defineProperty(agent, RUNTIME_PORTABLE_EVIDENCE, {
    value: evidence,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function runtimePortableEvidence(
  agent: AgentConfig,
): Readonly<Record<string, readonly RuntimePortableOperationEvidence[]>> {
  return (agent as AgentWithRuntimePolicies)[RUNTIME_PORTABLE_EVIDENCE] ?? {};
}

/** Adds the exact Codex apps and actions approved for one prepared run. */
export function attachRuntimeCodexAppPolicies(
  agent: AgentConfig,
  policies: Readonly<Record<string, RuntimeCodexAppPolicy>>,
): void {
  Object.defineProperty(agent, RUNTIME_CODEX_APP_POLICIES, {
    value: policies,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function runtimeCodexAppPolicies(
  agent: AgentConfig,
): Readonly<Record<string, RuntimeCodexAppPolicy>> {
  return (agent as AgentWithRuntimePolicies)[RUNTIME_CODEX_APP_POLICIES] ?? {};
}

/** Copies hidden policy metadata when runtime preparation creates a new agent value. */
export function copyRuntimeConnectionPolicies(source: AgentConfig, target: AgentConfig): void {
  const policies = runtimeConnectionPolicies(source);
  if (Object.keys(policies).length > 0) attachRuntimeConnectionPolicies(target, policies);
  const evidence = runtimePortableEvidence(source);
  if (Object.keys(evidence).length > 0) attachRuntimePortableEvidence(target, evidence);
  const appPolicies = runtimeCodexAppPolicies(source);
  if (Object.keys(appPolicies).length > 0) attachRuntimeCodexAppPolicies(target, appPolicies);
}
