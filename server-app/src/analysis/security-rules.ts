import { createHash } from 'crypto';
import { resolve } from 'path';
import type { AgentConfig } from '../agents/config.js';
import {
  COMMAND_TOOLS,
  WRITE_TOOLS,
  effectiveWorkingDirectory,
  hasAnyPermittedTool,
  hasEffectiveNetworkAccess,
} from '../execution/permission-policy.js';
import {
  FindingSchema,
  RiskSummarySchema,
  type Evidence,
  type Finding,
  type RiskSeverity,
  type RiskSummary,
} from './models.js';

type AnalysisInput = {
  agent: AgentConfig;
  rawContent: string;
  homeDir: string;
};

export type DeterministicSecurityResult = {
  contentHash: string;
  risk: RiskSummary;
  findings: Finding[];
};

export type SensitivePathResult = {
  normalizedPath: string;
  isSensitive: boolean;
  isBroad: boolean;
  category?: string;
};

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  low: 0,
  needs_review: 1,
  high: 2,
  critical: 3,
};

const SENSITIVE_PATHS: ReadonlyArray<{ pattern: RegExp; category: string }> = [
  { pattern: /\/(?:\.ssh)(?:\/|$)/i, category: 'SSH credentials' },
  { pattern: /\/(?:\.config)(?:\/|$)/i, category: 'application configuration' },
  { pattern: /\/(?:\.aws|\.azure|\.config\/gcloud)(?:\/|$)/i, category: 'cloud credentials' },
  { pattern: /\/(?:\.gnupg|\.docker|\.kube)(?:\/|$)/i, category: 'credential configuration' },
  { pattern: /\/(?:\.git-credentials|\.netrc|\.npmrc)(?:$|\/)/i, category: 'developer credentials' },
  { pattern: /\/Library\/Keychains(?:\/|$)/i, category: 'Keychain data' },
  { pattern: /\/(?:\.zsh_history|\.bash_history|\.python_history)(?:$|\/)/i, category: 'shell history' },
  { pattern: /\/Library\/(?:Safari|Application Support\/(?:Google\/Chrome|Firefox|1Password|Bitwarden))(?:\/|$)/i, category: 'browser or password data' },
  { pattern: /\/Library\/Developer\/Xcode\/UserData\/Provisioning Profiles(?:\/|$)/i, category: 'developer signing identities' },
  { pattern: /\/(?:\.env(?:\.[^/]+)?|id_(?:rsa|ed25519)|credentials)(?:$|\/)/i, category: 'secret configuration files' },
];

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk-(?:ant|live|test)?[-_A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
  /\bBearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?(?!\$\{)[^\s,'"}]{12,}/gi,
];

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return `${homeDir}/${path.slice(2)}`;
  return path;
}

export function detectSensitivePath(path: string, homeDir: string): SensitivePathResult {
  const normalizedPath = resolve(expandHome(path, homeDir));
  const normalizedHome = resolve(homeDir);
  const match = SENSITIVE_PATHS.find((entry) => entry.pattern.test(normalizedPath));
  return {
    normalizedPath,
    isSensitive: Boolean(match),
    isBroad: normalizedPath === normalizedHome || normalizedPath === '/',
    ...(match ? { category: match.category } : {}),
  };
}

export function computeAgentContentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function evidence(code: string, label: string, detail: string, source: Evidence['source']): Evidence {
  return { code, label, detail, source };
}

function action(
  ruleId: string,
  label: string,
  description: string,
  risk: RiskSeverity,
  affectsFunctionality: boolean,
): Finding['recommendation'] {
  return {
    id: `${ruleId}.fix`,
    label,
    description,
    kind: 'configuration_patch',
    risk,
    requires_confirmation: risk === 'high' || risk === 'critical',
    affects_functionality: affectsFunctionality,
  };
}

function finding(
  ruleId: string,
  severity: RiskSeverity,
  title: string,
  explanation: string,
  impact: string,
  trigger: string,
  facts: Evidence[],
  recommendation: Finding['recommendation'],
  index = 0,
): Finding {
  return FindingSchema.parse({
    id: `${ruleId}:${index}`,
    rule_id: ruleId,
    severity,
    title,
    explanation,
    potential_impact: impact,
    trigger,
    evidence: facts,
    recommendation,
    can_ignore: severity !== 'critical',
    model_generated: false,
    confidence: 1,
  });
}

function literalSecretCount(rawContent: string): number {
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of rawContent.matchAll(pattern)) {
      if (!match[0].includes('${')) count += 1;
    }
  }
  return count;
}

function analyzeSecrets(rawContent: string): Finding[] {
  const count = literalSecretCount(rawContent);
  if (count === 0) return [];
  return [finding(
    'secret.literal',
    'critical',
    'A secret appears to be stored in this agent',
    'Credentials in an agent file can be read by other local processes and copied with the file.',
    'Someone with the credential could access the connected service.',
    `${count} likely credential value${count === 1 ? '' : 's'} detected. Values were removed from this report.`,
    [evidence('secret', 'Detected value', `[REDACTED] (${count} finding${count === 1 ? '' : 's'})`, 'configuration')],
    action('secret.literal', 'Move the secret to connection settings', 'Replace the value with a named secure reference.', 'high', false),
  )];
}

function analyzePermissions(agent: AgentConfig): Finding[] {
  const findings: Finding[] = [];
  const canWrite = hasAnyPermittedTool(agent, WRITE_TOOLS);
  const canRunCommands = hasAnyPermittedTool(agent, COMMAND_TOOLS);
  const canUseNetwork = hasEffectiveNetworkAccess(agent);

  if (agent.codex_sandbox === 'danger-full-access') {
    findings.push(finding(
      'sandbox.unrestricted', 'critical', 'This agent has unrestricted access',
      'The runtime can reach files outside the intended working folder.',
      'A mistaken or malicious instruction could change personal or system files.',
      'The advanced sandbox setting is danger-full-access.',
      [evidence('sandbox', 'Access level', 'Unrestricted file access', 'configuration')],
      action('sandbox.unrestricted', 'Limit access to the working folder', 'Use workspace-only access.', 'needs_review', true),
    ));
  }

  if (agent.tools.length === 0 && agent.permission_mode === 'bypassPermissions') {
    findings.push(finding(
      'permissions.unrestricted_tools', 'critical', 'Every tool is allowed without approval',
      'An empty tool list means the runtime may use any available tool.',
      'The agent could run commands, edit files, or contact services beyond its stated task.',
      'All tools are available and approval checks are bypassed.',
      [evidence('tools', 'Allowed actions', 'All available tools', 'configuration')],
      action('permissions.unrestricted_tools', 'Allow only required actions', 'Create an explicit narrow permission list.', 'high', true),
    ));
  }

  if (canRunCommands && canUseNetwork) {
    findings.push(finding(
      'permissions.commands_and_network', 'high', 'This agent can run commands and use the internet',
      'Commands combined with external access can send local data away from this Mac.',
      'Untrusted instructions could cause files or command output to be transmitted.',
      'Command execution and external access are both enabled.',
      [
        evidence('commands', 'Commands', 'Allowed', 'configuration'),
        evidence('network', 'External access', 'Allowed', 'configuration'),
      ],
      action('permissions.commands_and_network', 'Remove one broad permission', 'Turn off commands or external access unless both are required.', 'high', true),
    ));
  } else if (canRunCommands) {
    findings.push(finding(
      'permissions.commands', 'high', 'This agent can run commands',
      'Commands can change files and start other programs.',
      'A command could have effects beyond the selected folder.',
      'Command execution is enabled.',
      [evidence('commands', 'Commands', 'Allowed', 'configuration')],
      action('permissions.commands', 'Turn off command access', 'Remove command access if the task can use app connections or file actions instead.', 'needs_review', true),
    ));
  }

  if (canWrite) {
    findings.push(finding(
      'permissions.file_write', 'high', 'This agent can change files',
      'File editing can overwrite or remove information in its writable area.',
      'A mistaken instruction could change files the user expected to keep.',
      'One or more file editing actions are enabled.',
      [evidence('write', 'File changes', 'Allowed', 'configuration')],
      action('permissions.file_write', 'Use read-only access', 'Turn off file editing when the task only needs to review information.', 'needs_review', true),
    ));
  }
  return findings;
}

function analyzePaths(agent: AgentConfig, homeDir: string): Finding[] {
  const canWrite = hasAnyPermittedTool(agent, WRITE_TOOLS) || hasAnyPermittedTool(agent, COMMAND_TOOLS);
  const hasFileGrants = Boolean(agent.file_access?.length);
  const candidates = [
    { path: effectiveWorkingDirectory(agent, homeDir), canWrite: hasFileGrants ? false : canWrite, priority: 0 },
    ...(agent.watch ?? []).map((watch) => ({ path: watch.path, canWrite, priority: 1 })),
    ...(agent.file_access ?? []).map((grant) => ({
      path: grant.path,
      canWrite: grant.access === 'read_write',
      priority: 2,
    })),
  ];
  const paths = new Map<string, { result: SensitivePathResult; canWrite: boolean; priority: number }>();
  for (const candidate of candidates) {
    const result = detectSensitivePath(candidate.path, homeDir);
    const existing = paths.get(result.normalizedPath);
    if (!existing || candidate.priority > existing.priority) {
      paths.set(result.normalizedPath, { result, canWrite: candidate.canWrite, priority: candidate.priority });
    } else if (candidate.priority === existing.priority) {
      paths.set(result.normalizedPath, {
        result,
        canWrite: candidate.canWrite && existing.canWrite,
        priority: candidate.priority,
      });
    }
  }
  return [...paths.values()].flatMap((entry, index) => {
    const { result } = entry;
    if (result.isSensitive) {
      return [finding(
        'path.sensitive', 'high', `This agent can access ${result.category}`,
        'This location often contains credentials or private account information.',
        'The agent could read or change sensitive information unrelated to its task.',
        `The configured path resolves inside ${result.category}.`,
        [evidence('path', 'Configured location', result.normalizedPath, 'configuration')],
        action('path.sensitive', 'Choose a safer folder', 'Select the narrow folder that contains only the files needed for this task.', 'needs_review', true),
        index,
      )];
    }
    if (result.isBroad && entry.canWrite) {
      return [finding(
        'path.broad_write', 'critical', 'This agent can change files across your home folder',
        'The writable area is much broader than most tasks require.',
        'A mistake could affect personal files outside the intended task.',
        'The working folder is the home folder and file changes or commands are allowed.',
        [evidence('path', 'Working folder', result.normalizedPath, 'configuration')],
        action('path.broad_write', 'Choose one working folder', 'Limit access to the narrow folder used by this task.', 'high', true),
        index,
      )];
    }
    return [];
  });
}

function getSemanticPrompt(agent: AgentConfig, rawContent: string): string {
  const trimmed = rawContent.trimStart();
  if (trimmed.startsWith('---') || /^[a-z][a-z0-9_-]*\s*:/im.test(trimmed)) return agent.prompt;
  return trimmed || agent.prompt;
}

function analyzePromptAndTriggers(agent: AgentConfig, rawContent: string): Finding[] {
  const findings: Finding[] = [];
  const prompt = getSemanticPrompt(agent, rawContent);
  const destructive = /\b(delete|erase|remove)\b.{0,80}\b(files?|folders?|records?|emails?)\b/i.test(prompt);
  const exfiltration = /\b(upload|send|post|forward)\b.{0,80}\b(every|all)\b.{0,30}\b(files?|source|secrets?|credentials?)\b/i.test(prompt);
  const canChangeFiles = hasAnyPermittedTool(agent, WRITE_TOOLS)
    || hasAnyPermittedTool(agent, COMMAND_TOOLS);
  const hasRelevantCapability = (destructive && canChangeFiles)
    || (exfiltration && hasEffectiveNetworkAccess(agent));
  if ((destructive || exfiltration) && hasRelevantCapability) {
    const asksForConfirmation = /\b(?:confirm|confirmation|approve|approval|preview)\b/i.test(prompt);
    const isAutomatic = Boolean(agent.schedule || agent.watch?.length);
    const severity: RiskSeverity = asksForConfirmation || !isAutomatic ? 'high' : 'critical';
    findings.push(finding(
      'prompt.destructive_or_exfiltration', severity, 'The instructions could delete or expose a large amount of data',
      'The task asks for broad deletion or transmission without a narrow scope.',
      'Files, messages, or credentials could be removed or sent outside this Mac.',
      'A destructive or broad transmission phrase appears in the instructions.',
      [evidence('prompt', 'Instruction pattern', 'Destructive or broad external action', 'configuration')],
      action('prompt.destructive_or_exfiltration', 'Require a preview and confirmation', 'Narrow the target and require approval before deletion or sending.', 'high', true),
    ));
  }

  const watchesUntrustedFiles = (agent.watch ?? []).some((watch) => /downloads|shared|inbox/i.test(watch.path));
  const followsInputInstructions = /follow (?:their|its|the) instructions|ignore (?:previous|all) instructions/i.test(prompt);
  const canChangeState = hasAnyPermittedTool(agent, WRITE_TOOLS)
    || hasAnyPermittedTool(agent, COMMAND_TOOLS)
    || hasEffectiveNetworkAccess(agent);
  if (watchesUntrustedFiles && followsInputInstructions && canChangeState) {
    findings.push(finding(
      'trigger.untrusted_writable_input', 'high', 'Untrusted files can tell this agent what to do',
      'Files placed in the watched folder may contain instructions from another person or program.',
      'A malicious document could cause file changes, commands, or external messages.',
      'The agent watches a shared or download folder, follows document instructions, and can change state.',
      [evidence('watch', 'Watched input', 'Potentially untrusted files', 'configuration')],
      action('trigger.untrusted_writable_input', 'Treat file contents as data', 'Add instructions to ignore commands inside documents and require review before actions.', 'needs_review', false),
    ));
  }
  return findings;
}

function analyzeConnectionsAndAutomation(agent: AgentConfig): Finding[] {
  const findings: Finding[] = [];
  const hasContactAccess = (agent.native_services?.contacts?.resources.length ?? 0) > 0;
  if (hasContactAccess) {
    findings.push(finding(
      'native.sensitive_contacts', 'needs_review', 'This agent can read selected contact details',
      'Contact names, email addresses, phone numbers, and birthdays are personal information.',
      'The agent could include approved contact details in its output.',
      'At least one Contacts group has been selected for read access.',
      [evidence('native-service', 'Contacts access', 'Selected groups only', 'configuration')],
      action('native.sensitive_contacts', 'Review contact details', 'Keep only the groups and detail types needed for this task.', 'needs_review', true),
    ));
  }
  if (agent.native_services?.contacts?.resources.some((resource) => resource.id.startsWith('container:'))) {
    findings.push(finding(
      'native.broad_contacts', 'high', 'This agent can read an entire Contacts account',
      'Account access is broader than choosing a contact group.',
      'The agent could read every contact stored in the selected account.',
      'All contacts were selected instead of a narrower group.',
      [evidence('native-service', 'Contacts scope', 'Entire selected account', 'configuration')],
      action('native.broad_contacts', 'Choose a contact group', 'Create or select a narrower group when the task does not need every contact.', 'needs_review', true),
    ));
  }
  const hasExternalOutput = hasEffectiveNetworkAccess(agent)
    || Boolean(agent.notification)
    || Boolean(agent.interaction)
    || [...(agent.permissions?.allow ?? agent.tools ?? [])].some((tool) => (
      tool.startsWith('mcp__') && !tool.startsWith('mcp__eventkit__')
    ));
  if (hasContactAccess && hasExternalOutput) {
    findings.push(finding(
      'native.contacts_external_access', 'high', 'Contact details could be sent outside Contacts',
      'This agent can read selected contact details and use an external app or internet service.',
      'Names, addresses, phone numbers, or birthdays could be included in an external message.',
      'Contacts access and external communication are both enabled.',
      [evidence('native-service', 'Combined access', 'Contacts and external services', 'configuration')],
      action('native.contacts_external_access', 'Limit external sharing', 'Remove external access or keep only the contact fields required for the task.', 'high', true),
    ));
  }
  for (const [name, server] of Object.entries(agent.mcp_servers ?? {})) {
    if ('url' in server) {
      const url = new URL(server.url);
      const isLoopback = url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '[::1]';
      if (url.protocol !== 'https:' && !isLoopback) {
        findings.push(finding(
          'connection.insecure_endpoint', 'high', 'A connected service uses an insecure address',
          'Information sent to this service is not protected by HTTPS.',
          'Someone on the network could read or change information sent by the agent.',
          `The ${name} connection uses HTTP outside this Mac.`,
          [evidence('endpoint', 'Connected service', url.origin, 'connection')],
          action('connection.insecure_endpoint', 'Use a secure service address', 'Replace the address with its HTTPS version.', 'needs_review', true),
        ));
      }
      continue;
    }
    const executable = server.command.split('/').at(-1)?.toLowerCase();
    const usesShell = ['bash', 'sh', 'zsh'].includes(executable ?? '')
      || (server.args ?? []).some((argument) => argument === '-c');
    if (usesShell) {
      findings.push(finding(
        'connection.shell_helper', 'high', 'A connected helper starts through a command shell',
        'Shell-based helpers can execute more than one command and are harder to restrict.',
        'A changed helper argument could run an unintended local command.',
        `The ${name} helper starts through ${executable ?? 'a shell'}.`,
        [evidence('command', 'Helper program', executable ?? 'shell', 'configuration')],
        action('connection.shell_helper', 'Use a direct helper program', 'Configure the helper executable without a command shell.', 'needs_review', true),
      ));
    }
  }

  const canChangeNativeState = [
    ...(agent.native_services?.calendar?.resources ?? []),
    ...(agent.native_services?.reminders?.resources ?? []),
  ].some((resource) => resource.actions.some((action) => action !== 'read'))
    || agent.calendar_access?.some((calendar) => calendar.access === 'read_write') === true;
  if (canChangeNativeState) {
    findings.push(finding(
      'native.state_change', 'high', 'This agent can change information in a Mac app',
      'It can add or update events or reminders within the access you approved.',
      'A mistaken instruction could change Calendar or Reminders information.',
      'At least one selected Calendar or Reminders resource allows changes.',
      [evidence('native-service', 'Mac app access', 'Changes allowed', 'configuration')],
      action('native.state_change', 'Review the selected access', 'Keep change access only for the calendars or lists this agent needs.', 'needs_review', true),
    ));
  }
  const isAutomatic = Boolean(agent.schedule || agent.watch?.length);
  const canChangeState = hasAnyPermittedTool(agent, WRITE_TOOLS)
    || hasAnyPermittedTool(agent, COMMAND_TOOLS)
    || canChangeNativeState;
  if (isAutomatic && canChangeState) {
    findings.push(finding(
      'trigger.automatic_state_change', 'high', 'This agent can make changes automatically',
      'Scheduled and watched agents can act while you are not reviewing each run.',
      'A mistaken instruction could change files, app information, or run a command without a fresh confirmation.',
      agent.watch?.length ? 'A file watcher can start a state-changing run.' : 'A schedule can start a state-changing run.',
      [evidence('trigger', 'Automatic trigger', agent.watch?.length ? 'File changes' : 'Schedule', 'configuration')],
      action('trigger.automatic_state_change', 'Require a manual first run', 'Test the agent manually before keeping its automatic trigger.', 'needs_review', true),
    ));
  }
  return findings;
}

function summarizeRisk(findings: Finding[]): RiskSummary {
  const level = findings.reduce<RiskSeverity>((highest, current) => (
    SEVERITY_ORDER[current.severity] > SEVERITY_ORDER[highest] ? current.severity : highest
  ), 'low');
  return RiskSummarySchema.parse({
    level,
    reasons: findings
      .filter((item) => item.severity === level)
      .slice(0, 6)
      .map((item) => item.title),
    finding_count: findings.length,
  });
}

export function analyzeAgentSecurity(input: AnalysisInput): DeterministicSecurityResult {
  const findings = [
    ...analyzeSecrets(input.rawContent),
    ...analyzePermissions(input.agent),
    ...analyzePaths(input.agent, input.homeDir),
    ...analyzePromptAndTriggers(input.agent, input.rawContent),
    ...analyzeConnectionsAndAutomation(input.agent),
  ];
  return {
    contentHash: computeAgentContentHash(input.rawContent),
    risk: summarizeRisk(findings),
    findings,
  };
}
