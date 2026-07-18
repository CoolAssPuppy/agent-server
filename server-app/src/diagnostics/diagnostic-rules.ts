import type { DiagnosticResult, Evidence, RecommendedAction, RiskSeverity } from '../analysis/models.js';
import { hasAnyPermittedTool, hasEffectiveNetworkAccess, WRITE_TOOLS } from '../execution/permission-policy.js';
import { sanitizeText } from '../server/security-utils.js';
import type { DiagnosticInput, DiagnosticRule } from './diagnostic-types.js';

type Diagnosis = {
  summary: string;
  cause: string;
  evidence: Evidence[];
  fix: RecommendedAction;
  risk?: RiskSeverity;
  rerunSafety?: 'safe' | 'confirm' | 'unsafe';
  source?: 'deterministic' | 'heuristic';
  canAutomate?: boolean;
};

function result(input: DiagnosticInput, diagnosis: Diagnosis): DiagnosticResult {
  return {
    schema_version: 1,
    run_id: input.run.runId,
    summary: diagnosis.summary,
    most_likely_cause: diagnosis.cause,
    confidence: diagnosis.source === 'heuristic' ? 0.8 : 1,
    evidence: diagnosis.evidence,
    suggested_fix: diagnosis.fix,
    affected_settings: diagnosis.fix.kind === 'configuration_patch' ? [diagnosis.fix.label] : [],
    risk: diagnosis.risk ?? diagnosis.fix.risk,
    can_automate: diagnosis.canAutomate ?? (diagnosis.fix.kind === 'retry' && !diagnosis.fix.requires_confirmation),
    rerun_safety: diagnosis.rerunSafety ?? (diagnosis.fix.requires_confirmation ? 'confirm' : 'safe'),
    alternatives: [],
    next_step: diagnosis.fix.description,
    source: diagnosis.source ?? 'deterministic',
  };
}

function evidence(code: string, label: string, detail: string, source: Evidence['source']): Evidence {
  return { code, label, detail: sanitizeText(detail, 1_000), source };
}

function action(
  id: string,
  label: string,
  description: string,
  kind: RecommendedAction['kind'],
  risk: RiskSeverity = 'low',
  requiresConfirmation = false,
): RecommendedAction {
  return {
    id,
    label,
    description,
    kind,
    risk,
    requires_confirmation: requiresConfirmation,
    affects_functionality: kind === 'configuration_patch' || kind === 'connect' || kind === 'choose_path',
  };
}

const readinessRules: DiagnosticRule[] = [
  (input) => !input.readiness.serverOnline ? result(input, {
    summary: 'Agent Server is not running.',
    cause: 'The local server was unavailable when the run was checked.',
    evidence: [evidence('server-offline', 'Server unavailable', 'The app could not reach the local Agent Server.', 'runtime')],
    fix: action('restart-server', 'Restart Agent Server', 'Start the local server, then retry the run.', 'retry'),
  }) : undefined,
  (input) => input.readiness.runAlreadyActive ? result(input, {
    summary: 'This agent is already running.',
    cause: 'A second run cannot start until the active run finishes or is stopped.',
    evidence: [evidence('run-active', 'Run in progress', 'An active run already holds this agent.', 'runtime')],
    fix: action('open-active-run', 'Open the active run', 'View its progress or stop it before trying again.', 'manual'),
  }) : undefined,
  (input) => input.readiness.agentParseError ? result(input, {
    summary: 'This agent file could not be read.',
    cause: 'The agent configuration contains an invalid or incomplete setting.',
    evidence: [evidence('agent-parse-error', 'Agent file error', input.readiness.agentParseError, 'configuration')],
    fix: action('repair-agent-file', 'Review the agent file repair', 'Preview a repair before changing the agent file.', 'configuration_patch', 'needs_review', true),
  }) : undefined,
  (input) => input.readiness.invalidSchedule ? result(input, {
    summary: 'This agent has an invalid run time.',
    cause: 'The saved schedule could not be understood.',
    evidence: [evidence('invalid-schedule', 'Run time is invalid', input.agent.schedule ?? 'The schedule is missing.', 'configuration')],
    fix: action('repair-schedule', 'Choose a valid run time', 'Review a corrected day and time before saving it.', 'configuration_patch'),
    canAutomate: true,
  }) : undefined,
  (input) => !input.readiness.runtimeAvailable ? result(input, {
    summary: 'The selected agent runtime is not available.',
    cause: 'The app could not find the runtime selected by this agent.',
    evidence: [evidence('runtime-unavailable', 'Runtime unavailable', `Selected runtime: ${input.agent.executor ?? 'claude-code'}`, 'runtime')],
    fix: action('choose-runtime', 'Use an available runtime', 'Review a change to an installed local runtime.', 'configuration_patch'),
  }) : undefined,
  (input) => !input.readiness.workingDirectoryExists ? result(input, {
    summary: 'The folder this agent uses could not be found.',
    cause: 'Its working folder may have been moved, renamed, or deleted.',
    evidence: [evidence('missing-working-directory', 'Folder not found', input.agent.working_directory ?? 'The configured working folder is unavailable.', 'filesystem')],
    fix: action('choose-working-directory', 'Choose a working folder', 'Select the folder this agent should use.', 'choose_path'),
  }) : undefined,
  (input) => (input.readiness.missingConnections?.length ?? 0) > 0 ? result(input, {
    summary: 'A required app or service is not connected.',
    cause: `${input.readiness.missingConnections?.join(', ')} must be connected before this agent can continue.`,
    evidence: [evidence('missing-connection', 'Connection needed', input.readiness.missingConnections?.join(', ') ?? 'A connection is missing.', 'connection')],
    fix: action('connect-service', 'Connect the required service', 'Review the access requested by the service, then connect it.', 'connect', 'needs_review', true),
  }) : undefined,
  (input) => (input.readiness.missingEnvironmentVariables?.length ?? 0) > 0 ? result(input, {
    summary: 'A secure connection setting is missing.',
    cause: 'The agent references a connection value that has not been configured.',
    evidence: [evidence('missing-secure-setting', 'Setup incomplete', `${input.readiness.missingEnvironmentVariables?.length} required value is missing.`, 'connection')],
    fix: action('configure-connection', 'Finish connection setup', 'Add the missing value in the secure connection settings.', 'connect', 'needs_review', true),
  }) : undefined,
  (input) => input.readiness.notificationReady === false && input.agent.notification ? result(input, {
    summary: 'The result could not be delivered.',
    cause: 'The selected message destination is not ready.',
    evidence: [evidence('notification-unavailable', 'Destination unavailable', `Selected destination: ${input.agent.notification.channel}`, 'connection')],
    fix: action('repair-notification', 'Review the message destination', 'Connect or choose the place where results should be sent.', 'connect', 'needs_review', true),
  }) : undefined,
  (input) => input.readiness.expectedOutputMissing ? result(input, {
    summary: 'The run finished without creating the expected result.',
    cause: 'The expected output file was not found after the run stopped.',
    evidence: [evidence('expected-output-missing', 'Expected result missing', input.readiness.expectedOutputMissing, 'filesystem')],
    fix: action('review-output', 'Review the output settings', 'Check the destination and instructions before retrying.', 'manual', 'needs_review', true),
    rerunSafety: 'confirm',
  }) : undefined,
];

const permissionRules: DiagnosticRule[] = [
  (input) => {
    const attemptedWrite = input.run.filesWritten.length > 0 || /\b(?:write|save|edit).{0,40}(?:denied|permission|read-only)\b/i.test(input.run.error ?? '');
    if (!attemptedWrite || hasAnyPermittedTool(input.agent, WRITE_TOOLS)) return undefined;
    return result(input, {
      summary: 'This agent tried to save a file, but file editing is turned off.',
      cause: 'The run needed to create or update a file outside its current read-only access.',
      evidence: [
        evidence(
          input.run.filesWritten[0] ? 'write-path' : 'write-attempt',
          'File save attempted',
          input.run.filesWritten[0] ?? 'The run reported a blocked save.',
          'run',
        ),
        evidence('write-disabled', 'File editing is off', 'No file editing tool is allowed for this agent.', 'configuration'),
      ],
      fix: action('review-write-access', 'Review file editing access', 'Allow edits only in the folder that should receive the output.', 'configuration_patch', 'high', true),
      risk: 'high',
      rerunSafety: 'confirm',
    });
  },
  (input) => input.readiness.networkRequired && !hasEffectiveNetworkAccess(input.agent) ? result(input, {
    summary: 'This agent needed the internet, but internet access is turned off.',
    cause: 'The requested app or web source cannot be reached with the current access.',
    evidence: [evidence('network-disabled', 'Internet access is off', 'The run requires a remote service.', 'configuration')],
    fix: action('review-network-access', 'Review internet access', 'Turn on internet access only for the service this agent needs.', 'configuration_patch', 'high', true),
    risk: 'high',
    rerunSafety: 'confirm',
  }) : undefined,
];

const heuristicRules: DiagnosticRule[] = [
  (input) => /(?:spawn\s+\S+\s+ENOENT|command not found|executable not found)/i.test(input.run.error ?? '') ? result(input, {
    summary: 'The selected agent runtime could not be started.',
    cause: 'The runtime command was not found on this Mac.',
    evidence: [evidence('missing-executable', 'Runtime command not found', input.run.error ?? 'The command was not found.', 'run')],
    fix: action('switch-runtime', 'Use an available runtime', 'Review a change to an installed local runtime.', 'configuration_patch'),
    source: 'heuristic',
  }) : undefined,
  (input) => /(?:ECONNREFUSED|ENOTFOUND|network is unreachable|timed? out)/i.test(input.run.error ?? '') ? result(input, {
    summary: 'The agent could not reach an app or service.',
    cause: 'The service may be unavailable, or the Mac may be offline.',
    evidence: [evidence('service-unreachable', 'Service unavailable', input.run.error ?? 'The connection failed.', 'run')],
    fix: action('retry-service', 'Retry the service', 'Check the connection, then retry without changing permissions.', 'retry'),
    source: 'heuristic',
  }) : undefined,
];

export function runLocalDiagnosticRules(input: DiagnosticInput): DiagnosticResult | undefined {
  for (const rule of [...readinessRules, ...permissionRules, ...heuristicRules]) {
    const diagnosis = rule(input);
    if (diagnosis) return diagnosis;
  }
  return undefined;
}
