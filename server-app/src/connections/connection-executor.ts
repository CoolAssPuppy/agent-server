import type { AgentConfig } from '../agents/config.js';
import type { ExecutorFn } from '../execution/executor-registry.js';
import type { ConnectionProfile } from './profile.js';
import { resolveAgentConnectionBindings } from './runtime-resolution.js';
import type { RuntimeAssignment } from '../agents/runtime-assignment.js';
import { applyRuntimeAssignment } from '../agents/runtime-assignment-resolution.js';
import type { AgentBindingSet } from '../agents/agent-binding-store.js';
import { prepareAgentConnections } from './prepared-agent.js';
import type { ConnectionCapabilitySnapshot } from './capability-snapshot.js';
import type {
  ConnectionOperationBindings,
  EmptyConnectionOperationBindings,
} from './operation-binding-store.js';
import { runtimePortableEvidence } from './runtime-policy.js';
import type { ExecutionResult, ToolCallTrace } from '../execution/executor.js';
import { prepareAgentSkills } from '../skills/prepared-skills.js';

type ConnectionProfileSource = {
  list: () => Promise<ConnectionProfile[]>;
};

type ExecutorResolver = (agent: AgentConfig) => ExecutorFn;

type RuntimeAssignmentSource = {
  get: (agentId: string) => Promise<RuntimeAssignment | undefined>;
};

type AgentBindingSource = {
  get: (agentId: string) => Promise<AgentBindingSet>;
};

type ConnectionCapabilitySource = {
  get: (connectionId: string) => Promise<ConnectionCapabilitySnapshot | undefined>;
};

type ConnectionOperationBindingSource = {
  get: (
    connectionId: string,
  ) => Promise<ConnectionOperationBindings | EmptyConnectionOperationBindings>;
};

function argumentAtPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    return Object.hasOwn(record, segment) ? record[segment] : undefined;
  }, input);
}

function normalizeToolCall(
  trace: ToolCallTrace,
  evidence: ReturnType<typeof runtimePortableEvidence>,
): ToolCallTrace {
  const candidates = evidence[trace.name];
  if (!candidates || candidates.length === 0) return trace;
  const matched = candidates.flatMap((candidate) => {
    const target = candidate.targets.find(({ argument, value }) => (
      Object.is(argumentAtPath(trace.input, argument), value)
    ));
    return target ? [{ candidate, target }] : [];
  });
  const untargeted = candidates.filter(({ targets }) => targets.length === 0);
  const selected = matched.length === 1
    ? matched[0]
    : matched.length === 0 && untargeted.length === 1
      ? { candidate: untargeted[0], target: undefined }
      : candidates.length === 1
        ? { candidate: candidates[0], target: undefined }
        : undefined;
  if (!selected) return trace;
  return {
    ...trace,
    portable: {
      use: selected.candidate.use,
      operation: selected.candidate.operation,
      ...(selected.target ? { target: selected.target.key } : {}),
    },
  };
}

function normalizeExecutionEvidence(agent: AgentConfig, result: ExecutionResult): ExecutionResult {
  const evidence = runtimePortableEvidence(agent);
  if (!result.toolCalls || Object.keys(evidence).length === 0) return result;
  return {
    ...result,
    toolCalls: result.toolCalls.map((trace) => normalizeToolCall(trace, evidence)),
  };
}

/** Builds an executor that refreshes saved connection profiles for every run. */
export function createConnectionResolvingExecutor(
  profiles: ConnectionProfileSource,
  resolveExecutor: ExecutorResolver,
  runtimeAssignments?: RuntimeAssignmentSource,
  agentBindings?: AgentBindingSource,
  capabilitySnapshots?: ConnectionCapabilitySource,
  operationBindingSource?: ConnectionOperationBindingSource,
): ExecutorFn {
  return async (agent, reporter, options) => {
    const runtimeAgent = applyRuntimeAssignment(
      agent,
      await runtimeAssignments?.get(agent.id),
    );
    const hasPortableConnections = runtimeAgent.connections
      && Object.keys(runtimeAgent.connections).length > 0;
    const hasPortableSkills = runtimeAgent.skills
      && Object.keys(runtimeAgent.skills).length > 0;
    const hasLegacyBindings = runtimeAgent.connection_bindings
      && Object.keys(runtimeAgent.connection_bindings).length > 0;
    if (hasPortableConnections && (!capabilitySnapshots || !operationBindingSource)) {
      throw new Error('Portable connection verification is unavailable on this server.');
    }
    const connectionProfiles = hasPortableConnections || hasLegacyBindings
      ? await profiles.list()
      : [];
    const snapshotEntries = hasPortableConnections && capabilitySnapshots
      ? await Promise.all(connectionProfiles.map(async (profile) => {
        const snapshot = await capabilitySnapshots.get(profile.id);
        return snapshot ? { id: profile.id, snapshot } : undefined;
      }))
      : undefined;
    const snapshots = snapshotEntries
      ? new Map(snapshotEntries.flatMap((entry) => entry ? [[entry.id, entry.snapshot]] : []))
      : undefined;
    const operationBindingEntries = hasPortableConnections && operationBindingSource
      ? await Promise.all(connectionProfiles.map(async (profile) => ({
        id: profile.id,
        bindings: await operationBindingSource.get(profile.id),
      })))
      : undefined;
    const operationBindings = operationBindingEntries
      ? new Map(operationBindingEntries.map(({ id, bindings }) => [id, bindings]))
      : undefined;
    const localBindings = hasPortableConnections || hasPortableSkills
      ? await agentBindings?.get(agent.id) ?? { revision: 0, connections: {}, skills: {} }
      : { revision: 0, connections: {}, skills: {} };
    const connectionPreparedAgent = hasPortableConnections
      ? prepareAgentConnections(
        runtimeAgent,
        localBindings,
        connectionProfiles,
        snapshots,
        operationBindings,
      )
      : runtimeAgent;
    const preparedAgent = hasPortableSkills
      ? await prepareAgentSkills(connectionPreparedAgent, localBindings)
      : connectionPreparedAgent;
    const resolvedAgent = preparedAgent.connection_bindings
      && Object.keys(preparedAgent.connection_bindings).length > 0
      ? resolveAgentConnectionBindings(preparedAgent, connectionProfiles)
      : preparedAgent;
    const result = await resolveExecutor(resolvedAgent)(resolvedAgent, reporter, options);
    return normalizeExecutionEvidence(resolvedAgent, result);
  };
}
