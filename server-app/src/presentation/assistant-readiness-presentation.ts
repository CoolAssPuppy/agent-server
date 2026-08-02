import type { AgentConfig } from '../agents/config.js';
import { getNextRun } from '../agents/scheduler.js';
import { COMMAND_TOOLS, WRITE_TOOLS, hasAnyPermittedTool } from '../execution/permission-policy.js';
import type {
  AssistantHomeInput,
  ReadinessCheck,
  ReadinessPresentation,
} from './assistant-home-models.js';
import { displayPath, evidenceStatement } from './assistant-presentation-support.js';

function engineCheck(input: AssistantHomeInput): ReadinessCheck {
  const { engine } = input.facts;
  if (!engine.runtimeAvailable) {
    return {
      kind: 'engine', state: 'fail',
      explanation: evidenceStatement('The selected AI engine is not available on this Mac.', 'runtime.paths'),
      action: { kind: 'edit', label: 'Choose AI engine', targetReference: `assistant:${input.agent.id}:edit` },
      evidenceSource: 'runtime.paths',
    };
  }
  if (engine.authentication === 'unavailable') {
    return {
      kind: 'engine', state: 'action_required',
      explanation: evidenceStatement('The selected AI engine needs you to sign in.', 'runtime.authentication'),
      action: { kind: 'edit', label: 'Review AI engine', targetReference: `assistant:${input.agent.id}:edit` },
      evidenceSource: 'runtime.authentication',
    };
  }
  if (engine.authentication === 'unknown') {
    return {
      kind: 'engine', state: 'unknown',
      explanation: evidenceStatement('AI engine sign-in will be checked when this agent runs.', 'runtime.authentication'),
      evidenceSource: 'runtime.authentication',
    };
  }
  return {
    kind: 'engine', state: 'pass',
    explanation: evidenceStatement('The selected AI engine is available and signed in.', 'runtime.authentication'),
    evidenceSource: 'runtime.authentication',
  };
}

function scheduleCheck(agent: AgentConfig, now: Date): ReadinessCheck {
  if (!agent.schedule) {
    return {
      kind: 'schedule', state: 'pass',
      explanation: evidenceStatement('This agent runs on demand.', 'agent.schedule'),
      evidenceSource: 'agent.schedule',
    };
  }
  try {
    getNextRun(agent, now);
    return {
      kind: 'schedule', state: 'pass',
      explanation: evidenceStatement('The automatic schedule is valid.', 'agent.schedule', 'agent.timezone'),
      evidenceSource: 'agent.schedule',
    };
  } catch {
    return {
      kind: 'schedule', state: 'fail',
      explanation: evidenceStatement('The automatic schedule is not valid.', 'agent.schedule', 'agent.timezone'),
      action: { kind: 'edit', label: 'Fix schedule', targetReference: `assistant:${agent.id}:edit` },
      evidenceSource: 'agent.schedule',
    };
  }
}

function requestedPaths(agent: AgentConfig): Array<{
  path: string;
  requiresWrite: boolean;
  source: string;
}> {
  if (agent.file_access?.length) {
    return agent.file_access.map((access, index) => ({
      path: access.path,
      requiresWrite: access.access === 'read_write',
      source: `agent.file_access[${index}]`,
    }));
  }
  if (!agent.working_directory) return [];
  return [{
    path: agent.working_directory,
    requiresWrite: hasAnyPermittedTool(agent, [...WRITE_TOOLS, ...COMMAND_TOOLS]),
    source: 'agent.working_directory',
  }];
}

function pathChecks(input: AssistantHomeInput): ReadinessCheck[] {
  const facts = new Map(input.facts.paths.map((fact) => [fact.path, fact]));
  return requestedPaths(input.agent).map(({ path, requiresWrite, source }) => {
    const fact = facts.get(path);
    if (!fact) {
      return {
        kind: 'file', state: 'unknown',
        explanation: evidenceStatement(`${displayPath(path)} could not be checked.`, source),
        evidenceSource: source,
      };
    }
    const hasAccess = fact.exists && fact.readable && (!requiresWrite || fact.writable);
    return hasAccess ? {
      kind: 'file' as const, state: 'pass' as const,
      explanation: evidenceStatement(`${displayPath(path)} is available.`, source),
      evidenceSource: source,
    } : {
      kind: 'file' as const, state: 'fail' as const,
      explanation: evidenceStatement(`${displayPath(path)} is missing or does not allow the required access.`, source),
      action: { kind: 'edit' as const, label: 'Choose file or folder', targetReference: `assistant:${input.agent.id}:edit` },
      evidenceSource: source,
    };
  });
}

function connectionChecks(input: AssistantHomeInput): ReadinessCheck[] {
  return input.facts.connections.map((connection) => {
    const state: ReadinessCheck['state'] = connection.status === 'ready' ? 'pass'
      : connection.status === 'needs_setup' ? 'action_required'
        : connection.status === 'unavailable' ? 'fail' : 'unknown';
    const explanation = state === 'pass' ? `${connection.label} is ready.`
      : state === 'action_required' ? `${connection.label} needs setup.`
        : state === 'fail' ? `${connection.label} is unavailable.`
          : `${connection.label} could not be checked.`;
    return {
      kind: 'connection', state,
      explanation: evidenceStatement(explanation, connection.sourceReference),
      ...(state === 'action_required' || state === 'fail' ? {
        action: {
          kind: 'edit' as const,
          label: 'Review connection',
          targetReference: `assistant:${input.agent.id}:edit`,
        },
      } : {}),
      evidenceSource: connection.sourceReference,
    };
  });
}

function destinationChecks(input: AssistantHomeInput): ReadinessCheck[] {
  const destination = input.facts.destination;
  if (!destination?.configured) return [];
  if (destination.verified === 'unknown') {
    return [{
      kind: 'destination', state: 'unknown',
      explanation: evidenceStatement('The result destination will be checked during the run.', 'agent.output.primary'),
      evidenceSource: 'agent.output.primary',
    }];
  }
  return [{
    kind: 'destination', state: destination.verified ? 'pass' : 'fail',
    explanation: evidenceStatement(
      destination.verified ? 'The result destination is available.' : 'The result destination is unavailable.',
      'agent.output.primary',
    ),
    ...(!destination.verified ? {
      action: { kind: 'edit' as const, label: 'Review destination', targetReference: `assistant:${input.agent.id}:edit` },
    } : {}),
    evidenceSource: 'agent.output.primary',
  }];
}

function readinessState(checks: readonly ReadinessCheck[]): ReadinessPresentation['state'] {
  if (checks.some((check) => check.state === 'fail')) return 'blocked';
  if (checks.some((check) => check.state === 'action_required')) return 'needs_setup';
  if (checks.some((check) => check.state === 'unknown')) return 'unavailable';
  return 'ready';
}

/** Convert deterministic facts into readiness without promoting unknown checks. */
export function createReadinessPresentation(input: AssistantHomeInput): ReadinessPresentation {
  const checks: ReadinessCheck[] = [
    {
      kind: 'server', state: 'pass',
      explanation: evidenceStatement('Agent Server is running on this Mac.', 'server.health'),
      evidenceSource: 'server.health',
    },
    engineCheck(input),
    scheduleCheck(input.agent, input.now),
    ...pathChecks(input),
    ...connectionChecks(input),
    {
      kind: 'permission', state: 'pass',
      explanation: evidenceStatement('The saved permission rules are valid.', 'agent.permissions', 'agent.file_access'),
      evidenceSource: 'agent.permissions',
    },
    ...destinationChecks(input),
  ];
  const state = readinessState(checks);
  const summary = state === 'ready' ? 'Ready to run.'
    : state === 'blocked' ? 'Resolve the blocked checks before running.'
      : state === 'needs_setup' ? 'Finish setup before running.'
        : 'Some setup could not be verified before a run.';
  return { state, summary: evidenceStatement(summary, 'readiness.checks'), checks };
}
