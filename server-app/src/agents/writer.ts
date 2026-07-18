import { readdir, readFile, writeFile, rename, mkdir } from 'fs/promises';
import { toErrorMessage } from '../util/errors.js';
import { join, extname } from 'path';
import { z } from 'zod';
import { Document, Scalar, parseDocument } from 'yaml';
import { CronExpressionParser } from 'cron-parser';
import {
  type AgentConfig,
  ProviderConfigSchema,
  hasFrontmatter,
  parseAgentFile,
  splitFrontmatter,
} from './config.js';
import { AGENT_EXTENSIONS } from './discovery.js';
import { NotificationConfigSchema } from '../interaction/schema.js';
import { loadEnvFile } from '../platform/config.js';
import {
  CAPABILITY_CATALOG,
  CapabilityError,
  applyCapabilityChanges,
  mcpServerKey,
  type CapabilityChange,
  type DiscoveredConnection,
} from './capabilities.js';

/**
 * Structured writes to agent definition files. This module is the only
 * place that mutates files in the agents directory on behalf of the API.
 *
 * Round-trip guarantee: updates are applied through the yaml Document API
 * (parseDocument + set/delete on individual keys), so comments, key order,
 * and fields the UI does not model survive every edit untouched. The only
 * exception is inside a field being replaced (e.g. comments between items
 * of a `tools:` list that a toggle rewrites).
 */

const CapabilityChangeSchema = z.object({
  id: z.string().min(1).max(200),
  enabled: z.boolean(),
});

const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const;

export const AgentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    schedule: z.string().trim().min(1).max(120).nullable().optional(),
    timezone: z.string().trim().min(1).max(120).nullable().optional(),
    prompt: z.string().trim().min(1).max(40_000).optional(),
    enabled: z.boolean().optional(),
    max_turns: z.number().int().positive().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    executor: z.enum(['claude-code', 'codex']).nullable().optional(),
    provider: ProviderConfigSchema.nullable().optional(),
    timeout: z.string().trim().min(1).max(16).nullable().optional(),
    permission_mode: z.enum(PERMISSION_MODES).nullable().optional(),
    tools: z.array(z.string().trim().min(1).max(120)).max(128).optional(),
    disallowed_tools: z.array(z.string().trim().min(1).max(120)).max(128).optional(),
    notification: NotificationConfigSchema.nullable().optional(),
    capabilities: z.array(CapabilityChangeSchema).max(64).optional(),
  })
  .strict();

export type AgentPatch = z.infer<typeof AgentPatchSchema>;

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const NewAgentSchema = z
  .object({
    id: z.string().trim().regex(AGENT_ID_PATTERN).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).optional(),
    prompt: z.string().trim().min(1).max(40_000),
    schedule: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(120).optional(),
    capabilities: z.array(CapabilityChangeSchema).max(64).optional(),
    notification: NotificationConfigSchema.optional(),
  })
  .strict();

export type NewAgentInput = z.infer<typeof NewAgentSchema>;

export type AgentWriteErrorCode = 'not_found' | 'already_exists' | 'invalid' | 'missing_env';

export class AgentWriteError extends Error {
  constructor(
    message: string,
    readonly code: AgentWriteErrorCode,
    readonly missingEnv?: string[],
  ) {
    super(message);
    this.name = 'AgentWriteError';
  }
}

type EnvSource = Record<string, string | undefined>;

export type AgentWriter = {
  update: (id: string, patch: AgentPatch) => Promise<AgentConfig>;
  create: (input: NewAgentInput) => Promise<AgentConfig>;
  remove: (id: string) => Promise<void>;
};

type LocatedAgent = { path: string; content: string; config: AgentConfig };

function isAgentFile(filename: string): boolean {
  return AGENT_EXTENSIONS.has(extname(filename));
}

async function locateAgentFile(directory: string, id: string): Promise<LocatedAgent | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }

  for (const file of entries.filter(isAgentFile).sort()) {
    const path = join(directory, file);
    try {
      const content = await readFile(path, 'utf-8');
      const config = parseAgentFile(content);
      if (config.id === id) return { path, content, config };
    } catch {
      continue;
    }
  }
  return null;
}

function assertValidSchedule(schedule: string): void {
  try {
    CronExpressionParser.parse(schedule);
  } catch {
    throw new AgentWriteError(`Invalid cron schedule: "${schedule}"`, 'invalid');
  }
}

function setDocField(doc: Document, key: string, value: unknown): void {
  if (value === null || value === undefined) {
    doc.delete(key);
    return;
  }
  const node = doc.createNode(value);
  if (typeof value === 'string' && value.includes('\n') && node instanceof Scalar) {
    node.type = Scalar.BLOCK_LITERAL;
  }
  doc.set(key, node);
}

/**
 * Collects the concrete field writes for a patch: explicit field edits
 * first, then capability toggles layered on top (a toggle recomputes
 * tools/disallowed_tools/mcp_servers from the post-patch state, so the two
 * compose instead of clobbering each other). Empty tool lists and empty
 * server maps are written as deletions to keep files clean — absence and
 * empty mean the same thing to the schema.
 */
function collectFieldWrites(
  config: AgentConfig,
  patch: AgentPatch,
  env: EnvSource,
  discovered: DiscoveredConnection[],
): Map<string, unknown> {
  const fields = new Map<string, unknown>();

  const direct: Array<keyof AgentPatch> = [
    'name',
    'description',
    'schedule',
    'timezone',
    'enabled',
    'max_turns',
    'model',
    'executor',
    'provider',
    'timeout',
    'permission_mode',
    'tools',
    'disallowed_tools',
    'notification',
  ];
  for (const key of direct) {
    if (patch[key] !== undefined) fields.set(key, patch[key]);
  }

  if (patch.capabilities && patch.capabilities.length > 0) {
    const working: AgentConfig = {
      ...config,
      tools: patch.tools ?? config.tools,
      disallowed_tools: patch.disallowed_tools ?? config.disallowed_tools,
    };
    let updates;
    try {
      updates = applyCapabilityChanges(working, patch.capabilities as CapabilityChange[], env, discovered);
    } catch (err) {
      if (err instanceof CapabilityError) {
        throw new AgentWriteError(
          err.message,
          err.code === 'missing_env' ? 'missing_env' : 'invalid',
          err.missingEnv,
        );
      }
      throw err;
    }
    if (updates.tools) fields.set('tools', updates.tools);
    if (updates.disallowed_tools) fields.set('disallowed_tools', updates.disallowed_tools);
    if (updates.mcp_servers) fields.set('mcp_servers', updates.mcp_servers);
  }

  // Empty collections mean the same as absent; delete the key for tidiness.
  for (const key of ['tools', 'disallowed_tools'] as const) {
    const value = fields.get(key);
    if (Array.isArray(value) && value.length === 0) fields.set(key, null);
  }
  const servers = fields.get('mcp_servers');
  if (servers && typeof servers === 'object' && Object.keys(servers).length === 0) {
    fields.set('mcp_servers', null);
  }

  return fields;
}

/**
 * Applies a patch to raw file content, preserving everything the patch does
 * not touch. Exported for tests; API callers go through createAgentWriter.
 */
export function applyPatchToContent(
  content: string,
  config: AgentConfig,
  patch: AgentPatch,
  env: EnvSource,
  discovered: DiscoveredConnection[] = [],
): string {
  if (patch.schedule) assertValidSchedule(patch.schedule);

  const fields = collectFieldWrites(config, patch, env, discovered);

  if (hasFrontmatter(content)) {
    const { yaml, body } = splitFrontmatter(content);
    const doc = parseDocument(yaml);
    for (const [key, value] of fields) setDocField(doc, key, value);
    // In frontmatter format the markdown body IS the prompt; a stray
    // `prompt` key in the frontmatter would silently lose to the body.
    if (patch.prompt !== undefined) doc.delete('prompt');
    const newBody = patch.prompt ?? body;
    return `---\n${doc.toString()}---\n\n${newBody}\n`;
  }

  const doc = parseDocument(content);
  for (const [key, value] of fields) setDocField(doc, key, value);
  if (patch.prompt !== undefined) setDocField(doc, 'prompt', patch.prompt);
  return doc.toString();
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.replace(/^[^a-z0-9]+/, '');
}

/**
 * Renders a new agent as frontmatter + markdown body (the consumer-default
 * format). When capabilities are provided, the file gets an explicit tools
 * allowlist built from the enabled ones, so anything the user left off is
 * off; without capabilities the file stays unrestricted like hand-written
 * agents.
 */
export function renderNewAgentFile(
  input: NewAgentInput,
  id: string,
  env: EnvSource,
  discovered: DiscoveredConnection[] = [],
): string {
  const frontmatter: Record<string, unknown> = { id, name: input.name };
  if (input.description) frontmatter.description = input.description;
  if (input.schedule) frontmatter.schedule = input.schedule;
  if (input.timezone) frontmatter.timezone = input.timezone;

  if (input.capabilities && input.capabilities.length > 0) {
    const allow: string[] = [];
    const deny: string[] = [];
    const servers: Record<string, unknown> = {};

    for (const change of input.capabilities) {
      const def = CAPABILITY_CATALOG.find((d) => d.id === change.id);
      if (!def) {
        throw new AgentWriteError(`Unknown capability "${change.id}"`, 'invalid');
      }
      if (def.kind === 'tools') {
        if (change.enabled) {
          for (const tool of def.tools ?? []) {
            if (!allow.includes(tool)) allow.push(tool);
          }
        } else {
          for (const tool of def.tools ?? []) {
            if (!deny.includes(tool)) deny.push(tool);
          }
        }
        continue;
      }
      // An account connector the runtime already reaches is keyed by its
      // runtime name (mcp__claude_ai_Slack), not the catalog's BYO name.
      const connector = discovered.find(
        (d) => def.match?.test(d.name) || (def.serverName && mcpServerKey(d.name) === mcpServerKey(def.serverName)),
      );
      const serverKey = connector ? mcpServerKey(connector.name) : def.serverName ?? def.id;
      if (change.enabled) {
        if (!def.builtin && !connector) {
          const enableResult = applyCapabilityChanges(
            // A minimal agent shape is enough for template instantiation.
            { id, name: input.name, prompt: input.prompt, tools: [], disallowed_tools: [], max_turns: 20, enabled: true } as AgentConfig,
            [change],
            env,
          );
          if (enableResult.mcp_servers?.[serverKey]) {
            servers[serverKey] = enableResult.mcp_servers[serverKey];
          }
        }
        if (!allow.includes(`mcp__${serverKey}`)) allow.push(`mcp__${serverKey}`);
      } else {
        if (!deny.includes(`mcp__${serverKey}`)) deny.push(`mcp__${serverKey}`);
      }
    }

    if (allow.length > 0) {
      frontmatter.tools = allow;
    } else if (deny.length > 0) {
      // Everything toggled off and nothing on: keep the file unrestricted
      // except for the explicit denials.
      frontmatter.disallowed_tools = deny;
    }
    if (Object.keys(servers).length > 0) frontmatter.mcp_servers = servers;
  }

  if (input.notification) frontmatter.notification = input.notification;

  const doc = new Document(frontmatter);
  return `---\n${doc.toString()}---\n\n${input.prompt}\n`;
}

export function createAgentWriter(
  directory: string,
  options?: { env?: () => EnvSource; connections?: () => DiscoveredConnection[] },
): AgentWriter {
  // Fresh read of ~/.agent-server/.env on every call so keys the user just
  // saved (e.g. via the app's Connect flow) are visible without a server
  // restart. Shell env still wins, matching CLI startup precedence.
  const getEnv = options?.env ?? (() => loadEnvFile(join(directory, '..'), process.env));
  // Cached discovery snapshot so a toggle of an account connector resolves to
  // the runtime server key (and skips writing a bring-your-own server).
  const getConnections = options?.connections ?? ((): DiscoveredConnection[] => []);

  return {
    async update(id: string, patch: AgentPatch): Promise<AgentConfig> {
      const located = await locateAgentFile(directory, id);
      if (!located) {
        throw new AgentWriteError(`Agent not found: ${id}`, 'not_found');
      }

      const newContent = applyPatchToContent(located.content, located.config, patch, getEnv(), getConnections());

      let updated: AgentConfig;
      try {
        updated = parseAgentFile(newContent);
      } catch (err) {
        const message = toErrorMessage(err);
        throw new AgentWriteError(`Patch produced an invalid agent file: ${message}`, 'invalid');
      }
      if (updated.id !== id) {
        throw new AgentWriteError('Patch must not change the agent id', 'invalid');
      }

      await writeAtomically(located.path, newContent);
      return updated;
    },

    async create(input: NewAgentInput): Promise<AgentConfig> {
      const id = input.id ?? slugify(input.name);
      if (!AGENT_ID_PATTERN.test(id)) {
        throw new AgentWriteError(
          `Could not derive a valid agent id from "${input.name}"; provide one explicitly`,
          'invalid',
        );
      }
      if (input.schedule) assertValidSchedule(input.schedule);

      const existing = await locateAgentFile(directory, id);
      if (existing) {
        throw new AgentWriteError(`An agent with id "${id}" already exists`, 'already_exists');
      }

      let content: string;
      try {
        content = renderNewAgentFile(input, id, getEnv(), getConnections());
      } catch (err) {
        if (err instanceof CapabilityError) {
          throw new AgentWriteError(
            err.message,
            err.code === 'missing_env' ? 'missing_env' : 'invalid',
            err.missingEnv,
          );
        }
        throw err;
      }

      let config: AgentConfig;
      try {
        config = parseAgentFile(content);
      } catch (err) {
        const message = toErrorMessage(err);
        throw new AgentWriteError(`Generated agent file is invalid: ${message}`, 'invalid');
      }

      await mkdir(directory, { recursive: true });
      const path = join(directory, `${id}.md`);
      try {
        await writeFile(path, content, { encoding: 'utf-8', flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new AgentWriteError(`A file named ${id}.md already exists`, 'already_exists');
        }
        throw err;
      }
      return config;
    },

    async remove(id: string): Promise<void> {
      const located = await locateAgentFile(directory, id);
      if (!located) {
        throw new AgentWriteError(`Agent not found: ${id}`, 'not_found');
      }

      // Soft delete: move into .deleted/ (invisible to discovery, which only
      // scans files with agent extensions at the top level) so a mistaken
      // tap in the app never destroys a hand-written agent.
      const trashDir = join(directory, '.deleted');
      await mkdir(trashDir, { recursive: true });
      const fileName = located.path.slice(located.path.lastIndexOf('/') + 1);
      const target = join(trashDir, `${Date.now()}-${fileName}`);
      await rename(located.path, target);
    },
  };
}
