import type { AgentBindingSet } from './agent-binding-store.js';
import type { AgentConfig } from './config.js';
import type { AgentExecutor } from './executor.js';
import { connectionServiceType, type ConnectionProfile } from '../connections/profile.js';
import { resolveAdapterOperation } from '../connections/operation-catalog.js';
import {
  connectionProfileFingerprint,
  type ConnectionCapabilitySnapshot,
} from '../connections/capability-snapshot.js';
import type {
  ConnectionOperationBindings,
  EmptyConnectionOperationBindings,
} from '../connections/operation-binding-store.js';

export type RuntimeCompatibilityState =
  | 'compatible'
  | 'needs_connection'
  | 'needs_review'
  | 'blocked';

export type RuntimeCompatibilityIssue = {
  code: string;
  message: string;
  use?: string;
  operation?: string;
  resource?: string;
};

export type RuntimeCompatibility = {
  state: RuntimeCompatibilityState;
  issues: RuntimeCompatibilityIssue[];
};

type RuntimeCompatibilityOptions = Readonly<{
  runtimeAvailable?: boolean;
  provider?: AgentConfig['provider'];
  environment?: Readonly<Record<string, string | undefined>>;
}>;

function resultState(issues: readonly RuntimeCompatibilityIssue[]): RuntimeCompatibilityState {
  if (issues.some(({ code }) => code === 'unsupported_operation'
    || code === 'unsupported_transport'
    || code === 'runtime_owned_connection'
    || code === 'unsupported_output_target'
    || code === 'ambiguous_output_evidence'
    || code === 'runtime_unavailable'
    || code === 'missing_provider_credential'
    || code === 'resource_access_mismatch')) return 'blocked';
  if (issues.some(({ code }) => code === 'connection_changed')) return 'needs_review';
  if (issues.length > 0) return 'needs_connection';
  return 'compatible';
}

/** Checks whether local settings can enforce an agent's contract on one runtime. */
export function evaluateRuntimeCompatibility(
  agent: AgentConfig,
  executor: AgentExecutor,
  bindings: AgentBindingSet,
  profiles: readonly ConnectionProfile[],
  capabilitySnapshots?: ReadonlyMap<string, ConnectionCapabilitySnapshot>,
  operationBindings?: ReadonlyMap<
    string,
    ConnectionOperationBindings | EmptyConnectionOperationBindings
  >,
  options: RuntimeCompatibilityOptions = {},
): RuntimeCompatibility {
  const issues: RuntimeCompatibilityIssue[] = [];
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const logicalOperationsByTool = new Map<string, Set<string>>();

  if (options.runtimeAvailable === false) {
    issues.push({
      code: 'runtime_unavailable',
      message: `The ${executor} runtime is not available on this machine.`,
    });
  }
  const providerCredential = options.provider?.api_key
    ? /^\$\{([A-Z][A-Z0-9_]*)}$/.exec(options.provider.api_key)?.[1]
    : undefined;
  if (providerCredential && !options.environment?.[providerCredential]?.trim()) {
    issues.push({
      code: 'missing_provider_credential',
      message: `The selected provider needs ${providerCredential}.`,
    });
  }

  for (const [skillKey, skill] of Object.entries(agent.skills ?? {})) {
    if (!bindings.skills?.[skillKey]) {
      issues.push({
        code: 'missing_skill',
        resource: skillKey,
        message: `Choose a local skill for ${JSON.stringify(skill.name)}.`,
      });
    }
  }

  for (const [useKey, use] of Object.entries(agent.connections ?? {})) {
    const binding = bindings.connections[useKey];
    if (!binding) {
      issues.push({
        code: 'missing_connection',
        use: useKey,
        message: `Choose a local connection for "${use.name}".`,
      });
      continue;
    }
    const profile = profilesById.get(binding.connection_id);
    if (!profile || connectionServiceType(profile) !== use.type) {
      issues.push({
        code: 'connection_changed',
        use: useKey,
        message: `Review the local connection selected for "${use.name}".`,
      });
      continue;
    }
    if (profile.transport.kind === 'runtime_account'
      && profile.transport.executor !== executor) {
      issues.push({
        code: 'runtime_connection_mismatch',
        use: useKey,
        message: `Choose a ${executor} connection for "${use.name}".`,
      });
      continue;
    }
    for (const operation of use.operations) {
      try {
        const savedMappings = operationBindings?.get(profile.id);
        const reviewed = savedMappings?.operations[operation];
        const snapshot = capabilitySnapshots?.get(profile.id);
        if (reviewed && (!('capability_version' in savedMappings)
          || savedMappings.capability_version !== snapshot?.capability_version)) {
          issues.push({
            code: 'connection_changed',
            use: useKey,
            operation,
            message: `Review "${use.name}" operations again before selecting this runtime.`,
          });
          continue;
        }
        const descriptor = resolveAdapterOperation(profile.adapter.id, operation, reviewed);
        const concreteIdentity = `${profile.id}\u0000${descriptor.tool}`;
        const logicalOperations = logicalOperationsByTool.get(concreteIdentity) ?? new Set<string>();
        logicalOperations.add(`${useKey}\u0000${operation}`);
        logicalOperationsByTool.set(concreteIdentity, logicalOperations);
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
            issues.push({
              code: 'connection_changed',
              use: useKey,
              operation,
              message: `Check "${use.name}" again before selecting this runtime.`,
            });
          }
        }
        const matchingResources = descriptor.targetType
          ? Object.values(use.resources).filter(({ type }) => type === descriptor.targetType)
          : [];
        const permittedResources = matchingResources.filter(({ access }) => (
          descriptor.effect === 'write'
            ? access === 'write' || access === 'read_write'
            : access === 'read' || access === 'read_write'
        ));
        if (descriptor.targetRequired && descriptor.targetField && descriptor.targetType
          && permittedResources.length === 0) {
          const access = descriptor.effect === 'write' ? 'writable' : 'readable';
          issues.push({
            code: 'resource_access_mismatch',
            use: useKey,
            operation,
            message: `"${use.name}" requires a ${access} ${descriptor.targetType} resource for ${operation}.`,
          });
        }
        const primary = agent.output?.primary;
        if (primary && 'use' in primary && primary.use === useKey
          && primary.operation === operation && primary.target) {
          const outputResource = use.resources[primary.target];
          const hasMatchingTarget = descriptor.targetField
            && descriptor.targetType
            && outputResource?.type === descriptor.targetType;
          const hasPermittedAccess = outputResource && (descriptor.effect === 'write'
            ? outputResource.access === 'write' || outputResource.access === 'read_write'
            : outputResource.access === 'read' || outputResource.access === 'read_write');
          if (!hasMatchingTarget || !hasPermittedAccess) {
            issues.push({
              code: 'unsupported_output_target',
              use: useKey,
              operation,
              resource: primary.target,
              message: `"${use.name}" cannot enforce the required output target.`,
            });
          }
        }
      } catch {
        issues.push({
          code: 'unsupported_operation',
          use: useKey,
          operation,
          message: `"${use.name}" cannot provide ${operation} through its selected connection.`,
        });
      }
    }
    for (const [resourceKey, resource] of Object.entries(use.resources)) {
      if (!binding.resources[resourceKey]) {
        issues.push({
          code: 'missing_resource',
          use: useKey,
          resource: resourceKey,
          message: `Choose a local resource for "${resource.purpose}".`,
        });
      }
    }
  }

  const primary = agent.output?.primary;
  if (primary && 'use' in primary && !primary.target) {
    const binding = bindings.connections[primary.use];
    const profile = binding ? profilesById.get(binding.connection_id) : undefined;
    const use = agent.connections?.[primary.use];
    if (profile && use) {
      try {
        const reviewed = operationBindings?.get(profile.id)?.operations[primary.operation];
        const descriptor = resolveAdapterOperation(profile.adapter.id, primary.operation, reviewed);
        const concreteIdentity = `${profile.id}\u0000${descriptor.tool}`;
        if ((logicalOperationsByTool.get(concreteIdentity)?.size ?? 0) > 1) {
          issues.push({
            code: 'ambiguous_output_evidence',
            use: primary.use,
            operation: primary.operation,
            message: `"${use.name}" cannot identify which logical connection use produced the required output.`,
          });
        }
      } catch {
        // The operation loop reports unsupported mappings.
      }
    }
  }

  if (executor !== 'claude-code') {
    const concreteTools = [
      ...agent.tools,
      ...(agent.permissions?.allow ?? []),
      ...(agent.permissions?.deny ?? []),
    ];
    if (concreteTools.some((tool) => tool.startsWith('mcp__claude_ai_'))) {
      issues.push({
        code: 'runtime_owned_connection',
        message: 'This legacy agent still uses Claude account connections.',
      });
    }
  }

  return { state: resultState(issues), issues };
}
