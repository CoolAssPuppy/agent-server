import type { AgentBindingSet } from '../agents/agent-binding-store.js';
import type { AgentConfig, AgentOutput } from '../agents/config.js';
import { connectionServiceType, type ConnectionProfile } from './profile.js';
import {
  connectionProfileFingerprint,
  type ConnectionCapabilitySnapshot,
} from './capability-snapshot.js';
import { resolveAdapterOperation, type AdapterOperation } from './operation-catalog.js';
import {
  attachRuntimeConnectionPolicies,
  attachRuntimeCodexAppPolicies,
  attachRuntimePortableEvidence,
  type PolicyValue,
  type RuntimePortableOperationEvidence,
} from './runtime-policy.js';
import type {
  ConnectionOperationBindings,
  EmptyConnectionOperationBindings,
} from './operation-binding-store.js';

export class AgentPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPreparationError';
  }
}

function concreteTool(runtimeName: string, tool: string): string {
  return `mcp__${runtimeName}__${tool}`;
}

function concreteRuntimeName(profile: ConnectionProfile): string {
  return profile.transport.kind === 'runtime_account' && profile.transport.executor === 'codex'
    ? 'codex_apps'
    : profile.runtime_name;
}

function isPortablePrimary(
  primary: AgentOutput['primary'],
): primary is Extract<AgentOutput['primary'], { use: string }> {
  return 'use' in primary;
}

function localResourceId(
  bindings: AgentBindingSet,
  useKey: string,
  resourceKey: string,
  operation: string,
): string | undefined {
  const resource = bindings.connections[useKey]?.resources[resourceKey];
  return resource?.operation_ids?.[operation] ?? resource?.id;
}

/** Combines a shareable agent with machine-local connection and resource choices. */
export function prepareAgentConnections(
  agent: AgentConfig,
  bindings: AgentBindingSet,
  profiles: readonly ConnectionProfile[],
  capabilitySnapshots?: ReadonlyMap<string, ConnectionCapabilitySnapshot>,
  operationBindings?: ReadonlyMap<
    string,
    ConnectionOperationBindings | EmptyConnectionOperationBindings
  >,
): AgentConfig {
  if (!agent.connections || Object.keys(agent.connections).length === 0) return agent;

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const connectionBindings: Record<string, string> = {};
  const allowedTools: string[] = [];
  const operationsByUse = new Map<string, Map<string, AdapterOperation & { concreteTool: string }>>();
  const connectionLines: string[] = [];
  const resourceLines: string[] = [];
  const policies: Record<string, {
    allowedTools: string[];
    argumentConstraints: Record<string, Record<string, PolicyValue[]>>;
  }> = {};
  const portableEvidence: Record<string, RuntimePortableOperationEvidence[]> = {};
  const codexAppPolicies: Record<string, {
    availableTools: string[];
    tools: Record<string, { effect: 'read' | 'write' }>;
  }> = {};

  for (const [useKey, use] of Object.entries(agent.connections)) {
    const binding = bindings.connections[useKey];
    if (!binding) {
      throw new AgentPreparationError(`Choose a local connection for "${use.name}" before running this agent.`);
    }
    const profile = profilesById.get(binding.connection_id);
    if (!profile) {
      throw new AgentPreparationError(`The local connection selected for "${use.name}" is unavailable.`);
    }
    if (connectionServiceType(profile) !== use.type) {
      throw new AgentPreparationError(
        `Connection "${profile.label}" cannot fill the ${use.type} use named "${use.name}".`,
      );
    }
    connectionLines.push(
      `- ${useKey}: name=${JSON.stringify(use.name)}; type=${use.type}; purpose=${JSON.stringify(use.purpose)}`,
    );
    if (profile.transport.kind !== 'runtime_account') {
      connectionBindings[profile.runtime_name] = profile.id;
    }
    const runtimeName = concreteRuntimeName(profile);
    const policy = policies[runtimeName] ?? {
      allowedTools: [],
      argumentConstraints: {},
    };
    policies[runtimeName] = policy;
    const codexAppPolicy = profile.transport.kind === 'runtime_account'
      && profile.transport.executor === 'codex'
      ? (codexAppPolicies[profile.transport.server_name] ?? { availableTools: [], tools: {} })
      : undefined;
    if (codexAppPolicy && profile.transport.kind === 'runtime_account') {
      codexAppPolicies[profile.transport.server_name] = codexAppPolicy;
      for (const { runtime_name: availableTool } of capabilitySnapshots?.get(profile.id)?.operations ?? []) {
        if (!codexAppPolicy.availableTools.includes(availableTool)) {
          codexAppPolicy.availableTools.push(availableTool);
        }
      }
    }
    const operationTools = new Map<string, AdapterOperation & { concreteTool: string }>();
    for (const operation of use.operations) {
      const savedMappings = operationBindings?.get(profile.id);
      const reviewed = savedMappings?.operations[operation];
      const snapshot = capabilitySnapshots?.get(profile.id);
      if (reviewed && (!('capability_version' in savedMappings)
        || savedMappings.capability_version !== snapshot?.capability_version)) {
        throw new AgentPreparationError(`Review "${use.name}" operations again before running.`);
      }
      const descriptor = resolveAdapterOperation(profile.adapter.id, operation, reviewed);
      if (capabilitySnapshots) {
        const isCurrent = snapshot?.connection_id === profile.id
          && snapshot.adapter.id === profile.adapter.id
          && snapshot.adapter.version === profile.adapter.version
          && snapshot.profile_fingerprint === connectionProfileFingerprint(profile);
        const available = snapshot?.operations.find(({ runtime_name: runtimeName }) => (
          runtimeName === descriptor.tool
        ));
        const isAvailable = available !== undefined
          && (reviewed !== undefined || available.classification === 'curated');
        if (!isCurrent || !isAvailable) {
          throw new AgentPreparationError(
            `Check "${use.name}" again before running ${operation}.`,
          );
        }
      }
      const matchingResources = descriptor.targetType
        ? Object.entries(use.resources).filter(([, { type }]) => type === descriptor.targetType)
        : [];
      const permittedResources = matchingResources.filter(([, { access }]) => (
        descriptor.effect === 'write'
          ? access === 'write' || access === 'read_write'
          : access === 'read' || access === 'read_write'
      ));
      if (descriptor.effect === 'write' && matchingResources.length > 0
        && permittedResources.length === 0) {
        throw new AgentPreparationError(
          `"${use.name}" cannot use ${operation} with read-only resources.`,
        );
      }
      if (descriptor.targetRequired && descriptor.targetField && descriptor.targetType
        && permittedResources.length === 0) {
        const access = descriptor.effect === 'write' ? 'writable' : 'readable';
        throw new AgentPreparationError(
          `"${use.name}" requires a ${access} ${descriptor.targetType} resource for ${operation}.`,
        );
      }
      const tool = concreteTool(runtimeName, descriptor.tool);
      const targetField = descriptor.targetField;
      const targetType = descriptor.targetType;
      operationTools.set(operation, { ...descriptor, concreteTool: tool });
      const toolEvidence = portableEvidence[tool] ?? [];
      toolEvidence.push({
        use: useKey,
        operation,
        targets: targetField && targetType
          ? permittedResources.flatMap(([resourceKey, resource]) => {
            const targetId = localResourceId(bindings, useKey, resourceKey, operation);
            return resource.type === targetType && targetId
              ? [{ key: resourceKey, argument: targetField, value: targetId }]
              : [];
          })
          : [],
      });
      portableEvidence[tool] = toolEvidence;
      allowedTools.push(tool);
      if (!policy.allowedTools.includes(descriptor.tool)) policy.allowedTools.push(descriptor.tool);
      if (codexAppPolicy) {
        codexAppPolicy.tools[descriptor.tool] = { effect: descriptor.effect };
      }
      if (descriptor.targetField && descriptor.targetType) {
        const permittedTargets = permittedResources
          .map(([resourceKey]) => localResourceId(bindings, useKey, resourceKey, operation))
          .filter((id): id is string => id !== undefined);
        if (permittedTargets.length > 0) {
          const toolConstraints = policy.argumentConstraints[descriptor.tool] ?? {};
          const values = toolConstraints[descriptor.targetField] ?? [];
          for (const target of permittedTargets) {
            if (!values.includes(target)) values.push(target);
          }
          toolConstraints[descriptor.targetField] = values;
          policy.argumentConstraints[descriptor.tool] = toolConstraints;
        }
      }
    }
    operationsByUse.set(useKey, operationTools);
    for (const [resourceKey, resource] of Object.entries(use.resources)) {
      const localResource = binding.resources[resourceKey];
      if (!localResource) {
        throw new AgentPreparationError(
          `Choose a local resource for "${resource.purpose}" before running this agent.`,
        );
      }
      resourceLines.push(
        `- ${useKey}.${resourceKey}: id=${JSON.stringify(localResource.id)}; type=${resource.type}; access: ${resource.access}; purpose=${JSON.stringify(resource.purpose)}`,
      );
      for (const operation of use.operations) {
        const descriptor = operationsByUse.get(useKey)?.get(operation);
        if (!descriptor?.targetField || descriptor.targetType !== resource.type) continue;
        const operationId = localResource.operation_ids?.[operation] ?? localResource.id;
        resourceLines.push(
          `- ${useKey}.${resourceKey}.${operation}: set ${descriptor.targetField}=${JSON.stringify(operationId)}`,
        );
      }
    }
  }

  let output = agent.output;
  if (output && isPortablePrimary(output.primary)) {
    const primary = output.primary;
    const operation = operationsByUse.get(primary.use)?.get(primary.operation);
    if (!operation) {
      throw new AgentPreparationError(
        `Primary output operation "${primary.operation}" is not declared by connection use "${primary.use}".`,
      );
    }
    if (!primary.target) {
      const evidenceCandidates = portableEvidence[operation.concreteTool] ?? [];
      const logicalOperations = new Set(evidenceCandidates.map(({ use, operation: operationId }) => (
        `${use}\u0000${operationId}`
      )));
      if (logicalOperations.size > 1) {
        throw new AgentPreparationError(
          `Primary output operation "${primary.operation}" cannot identify which logical connection use produced it. Add an enforceable target or bind the uses to different connections.`,
        );
      }
    }
    const target = primary.target
      ? localResourceId(bindings, primary.use, primary.target, primary.operation)
      : undefined;
    if (primary.target && !target) {
      throw new AgentPreparationError(`Primary output resource "${primary.target}" has no local binding.`);
    }
    if (primary.target) {
      const resource = agent.connections?.[primary.use]?.resources[primary.target];
      const hasMatchingTarget = operation.targetField
        && operation.targetType
        && resource?.type === operation.targetType;
      const hasPermittedAccess = resource && (operation.effect === 'write'
        ? resource.access === 'write' || resource.access === 'read_write'
        : resource.access === 'read' || resource.access === 'read_write');
      if (!hasMatchingTarget || !hasPermittedAccess) {
        throw new AgentPreparationError(
          `Primary output operation "${primary.operation}" cannot enforce output target "${primary.target}".`,
        );
      }
    }
    output = {
      ...output,
      primary: {
        description: primary.description,
        tool: operation.concreteTool,
        ...(target ? { target } : {}),
        ...(primary.required !== undefined ? { required: primary.required } : {}),
        ...(primary.successful_calls ? { successful_calls: primary.successful_calls } : {}),
        ...(target && operation.targetField
          ? { target_match: { field: operation.targetField, equals: target } }
          : {}),
      },
    };
  }

  const operationLines = [...operationsByUse.entries()].flatMap(([useKey, operations]) =>
    [...operations.entries()].map(([operation, descriptor]) =>
      `- ${useKey}.${operation}: ${descriptor.concreteTool}`));
  const runtimeContext = [
    '<agent_server_bindings>',
    'Use these concrete tools and local resources for this run:',
    ...connectionLines,
    ...operationLines,
    ...resourceLines,
    '</agent_server_bindings>',
  ].join('\n');

  const prepared: AgentConfig = {
    ...agent,
    prompt: `${agent.prompt}\n\n${runtimeContext}`,
    connection_bindings: connectionBindings,
    permissions: {
      allow: [...new Set([...(agent.permissions?.allow ?? []), ...allowedTools])],
      deny: agent.permissions?.deny ?? [],
    },
    output,
  };
  attachRuntimeConnectionPolicies(
    prepared,
    policies,
  );
  attachRuntimePortableEvidence(prepared, portableEvidence);
  if (Object.keys(codexAppPolicies).length > 0) {
    attachRuntimeCodexAppPolicies(prepared, codexAppPolicies);
  }
  return prepared;
}
