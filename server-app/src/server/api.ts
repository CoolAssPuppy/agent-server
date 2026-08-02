import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { toErrorMessage } from '../util/errors.js';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import { EXECUTOR_NAMES, type AgentExecutor } from '../agents/executor.js';
import {
  catalogSummary,
  deriveCapabilities,
  redactAgentSecrets,
  type DiscoveredConnection,
} from '../agents/capabilities.js';
import { availableConnections, buildServiceRegistry } from '../services/registry.js';
import { ConnectionProfileDraftSchema } from '../connections/profile.js';
import type { ConnectionProfileStore } from '../connections/profile-store.js';
import {
  AgentPatchSchema,
  AgentWriteError,
  NewAgentSchema,
  type AgentWriter,
} from '../agents/writer.js';
import type { RunStoreLike } from '../reporting/store.js';
import { USER_CANCELED_CODE } from '../execution/runner.js';
import { normalizeStoredRun } from '../reporting/run-normalization.js';
import { computeAgentMetrics } from '../reporting/metrics.js';
import { createRunReview } from '../presentation/run-review.js';
import {
  createActivityPresentation,
  createTodayPresentation,
} from '../presentation/today-activity.js';
import {
  createAssistantHomePresentation,
  type AssistantHomeFacts,
} from '../presentation/assistant-home.js';
import type { InteractionStore, PendingInteraction } from '../interaction/store.js';
import type { PendingDecision } from '../reporting/realtime-client.js';
import type { PreflightResult } from '../analysis/models.js';
import { evaluateRunPreflight, type RunPreflightOutcome } from '../analysis/run-preflight.js';
import { RunPreflightDeniedError } from '../analysis/run-preflight-gate.js';
import {
  AuthFailureTracker,
  InMemoryRateLimiter,
  getClientIp,
  sanitizePromptSuffix,
  sanitizeText,
} from './security-utils.js';
import { AGENT_SERVER_VERSION } from '../version.js';

type EnvSource = Record<string, string | undefined>;
const LOCAL_API_VERSION = 12;
const MACHINE_PROTOCOL_VERSION = 2;

type ConnectionSnapshot = {
  servers: DiscoveredConnection[];
  discovered_at: string | null;
  probe_failed?: boolean;
  runtimes?: Array<{
    id: string;
    label: string;
    installed: boolean;
    authentication: 'unknown';
  }>;
};

/** Read/refresh surface over the app-wide connection discovery cache. */
type ConnectionSource = {
  get: () => ConnectionSnapshot;
  ensure?: () => Promise<ConnectionSnapshot>;
  refresh: () => Promise<ConnectionSnapshot>;
};

type ApiDependencies = {
  getAgents: () => Promise<AgentConfig[]>;
  /** Current machine-local interactions awaiting a user response. */
  getPendingInteractions?: () => PendingInteraction[];
  /** Machine-local interaction response authority. */
  interactions?: Pick<InteractionStore, 'get' | 'claim' | 'complete' | 'restore'>;
  store: RunStoreLike;
  triggerRun: (
    agentId: string,
    promptSuffix?: string,
    security?: { confirmedContentHash?: string },
  ) => Promise<string>;
  triggerSafeTest?: (agentId: string) => Promise<string>;
  preflightRun?: (agentId: string) => Promise<PreflightResult>;
  cancelRun?: (runId: string) => boolean;
  cleanupFn?: () => Promise<number>;
  /**
   * Current pending decisions for the org, sourced from the daemon's Supabase
   * Realtime subscription. Absent when the daemon has no panel configured.
   */
  getPendingDecisions?: () => PendingDecision[];
  /**
   * Structured writes to agent definition files. Absent in contexts that
   * have no agents directory (e.g. some tests); write routes then 501.
   */
  agentWriter?: AgentWriter;
  /**
   * Env source used for capability readiness checks. Should read fresh
   * .env values so newly saved keys are visible without a restart.
   */
  getEnv?: () => EnvSource;
  /**
   * App-wide cache of the MCP discovery probe (the connectors the Claude
   * runtime can reach). `get()` is a synchronous read of the last snapshot;
   * `refresh()` re-probes (the "Refresh connections" action). Absent in
   * tests/contexts without a runtime; the connection routes then serve an
   * empty snapshot and capability lists fall back to built-ins + configured.
   */
  connections?: ConnectionSource;
  /** Workspace-local user-named connection definitions. Values remain in .env. */
  connectionProfiles?: Pick<
    ConnectionProfileStore,
    'list' | 'create' | 'rename' | 'duplicate' | 'remove'
  >;
  /** Optional local security analysis and configuration patch routes. */
  analysisApi?: Hono;
  /** Optional local guided creation and debugger routes. */
  guidanceApi?: Hono;
  apiKey: string;
  machineId?: string;
  /** Injectable time sources keep presentation snapshots deterministic in tests. */
  presentationClock?: () => Date;
  presentationWindow?: (now: Date) => {
    recentSince: Date;
    upcomingUntil: Date;
  };
  /** Deterministic local facts used by the consumer Assistant home adapter. */
  assistantHomeFacts?: (
    agent: AgentConfig,
    allAgents: AgentConfig[],
  ) => Promise<AssistantHomeFacts>;
  startedAt?: string;
  host?: string;
};

const MAX_BODY_BYTES = 8_192;
// Agent definitions carry the full prompt (up to 40k chars), so create and
// update bodies need far more headroom than the other routes.
const MAX_AGENT_WRITE_BODY_BYTES = 256 * 1024;
const TriggerRunBodySchema = z.object({
  with: z.string().trim().max(4_000).optional(),
  confirmed_content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
});
const ConnectionLabelSchema = z.object({
  label: z.string().trim().min(1).max(120),
}).strict();
const InteractionReplyBodySchema = z.object({
  response: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('option'),
      optionIndex: z.number().int(),
    }).strict(),
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }).strict(),
  ]),
}).strict();

function projectInteraction(interaction: PendingInteraction, now = new Date()): Record<string, unknown> {
  const status = interaction.status === 'pending' && interaction.expiresAt <= now
    ? 'expired'
    : interaction.status;
  return {
    interaction_id: interaction.id,
    run_id: interaction.runId,
    assistant_id: interaction.agentId,
    message: interaction.request.message,
    options: (interaction.request.options ?? []).map((option, index) => ({
      index,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
    allows_free_text: interaction.request.freeText,
    expires_at: interaction.expiresAt.toISOString(),
    status,
  };
}

function localTodayWindow(now: Date): { recentSince: Date; upcomingUntil: Date } {
  const recentSince = new Date(now);
  recentSince.setHours(0, 0, 0, 0);
  const upcomingUntil = new Date(recentSince);
  upcomingUntil.setDate(upcomingUntil.getDate() + 1);
  return { recentSince, upcomingUntil };
}

function isAgentWriteRequest(method: string, path: string): boolean {
  if (method === 'POST' && path === '/agents') return true;
  if (method === 'POST' && path.startsWith('/guidance/agent-proposals')) return true;
  if (method === 'POST' && /^\/guidance\/agents\/[^/]+\/similar-proposals$/.test(path)) return true;
  if (method === 'POST' && path === '/connection-profiles') return true;
  return method === 'PUT' && /^\/agents\/[^/]+$/.test(path);
}

function preflightDeniedStatus(
  code: Extract<RunPreflightOutcome, { allowed: false }>['code'],
): 403 | 409 | 428 {
  if (code === 'blocked') return 403;
  if (code === 'content_changed') return 409;
  return 428;
}

function isAuthorized(requestKey: string | undefined, expectedKey: string): boolean {
  if (!requestKey) return false;

  const requestBuffer = Buffer.from(requestKey);
  const expectedBuffer = Buffer.from(expectedKey);
  if (requestBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(requestBuffer, expectedBuffer);
}

function extractApiKeyHeader(request: Request): string | undefined {
  const explicitHeader = request.headers.get('x-agent-server-key')?.trim();
  if (explicitHeader) return explicitHeader;

  const authHeader = request.headers.get('authorization')?.trim();
  if (!authHeader) return undefined;

  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (scheme.toLowerCase() !== 'bearer' || !token) return undefined;

  return token;
}

type NodeRequestInit = RequestInit & { duplex: 'half' };

async function bufferRequestWithinLimit(request: Request, maxBytes: number): Promise<Request | null> {
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const requestInit: NodeRequestInit = { body, duplex: 'half' };
  return new Request(request, requestInit);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function parseOriginHost(originHeader: string): string | undefined {
  try {
    const origin = new URL(originHeader);
    return origin.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isSameOriginRequest(request: Request, expectedHost?: string): boolean {
  const originHeader = request.headers.get('origin')?.trim();
  if (!originHeader) return true;

  const originHost = parseOriginHost(originHeader);
  if (!originHost) return false;

  if (!expectedHost) return false;
  const normalizedExpected = expectedHost.trim().toLowerCase();
  if (originHost === normalizedExpected) return true;

  if (isLoopbackHost(normalizedExpected) && isLoopbackHost(originHost)) return true;

  return false;
}

export function createApi(deps: ApiDependencies): Hono {
  const app = new Hono();
  const apiKey = deps.apiKey.trim();
  if (apiKey.length < 16) {
    throw new Error('A strong AGENT_SERVER_API_KEY is required');
  }

  const generalLimiter = new InMemoryRateLimiter(180, 60_000);
  const triggerLimiter = new InMemoryRateLimiter(20, 60_000);
  const authFailures = new AuthFailureTracker(10, 10 * 60_000);

  app.use(async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');

    const isPublicHealthRequest = c.req.path === '/health'
      && (c.req.method === 'GET' || c.req.method === 'HEAD');
    if (isPublicHealthRequest) {
      await next();
      return c.res;
    }

    let remoteAddress: string | undefined;
    try {
      remoteAddress = getConnInfo(c).remote.address;
    } catch {
      // In-memory Hono requests used by tests do not expose Node socket data.
    }
    const ip = getClientIp(c.req.raw, { remoteAddress, trustProxyHeaders: false });

    const throttle = generalLimiter.consume(ip);
    if (!throttle.allowed) {
      c.header('Retry-After', String(throttle.retryAfterSeconds ?? 60));
      return c.json({ error: 'Too many requests' }, 429);
    }

    const isMutationRequest = c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
    if (isMutationRequest && !isSameOriginRequest(c.req.raw, deps.host)) {
      console.warn(`[api] Rejected cross-origin mutation from ${sanitizeText(c.req.raw.headers.get('origin') ?? 'unknown', 120)}`);
      return c.json({ error: 'Cross-origin mutation blocked' }, 403);
    }

    const requestKey = extractApiKeyHeader(c.req.raw);
    if (!isAuthorized(requestKey, apiKey)) {
      const blocked = authFailures.isBlocked(ip);
      if (!blocked.allowed) {
        c.header('Retry-After', String(blocked.retryAfterSeconds ?? 60));
        return c.json({ error: 'Too many failed auth attempts' }, 429);
      }

      const failure = authFailures.registerFailure(ip);
      console.warn(`[api] Unauthorized request from ${sanitizeText(ip, 64)} to ${sanitizeText(c.req.path, 80)}`);
      if (!failure.allowed) {
        c.header('Retry-After', String(failure.retryAfterSeconds ?? 60));
      }
      const response = failure.allowed
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'Too many failed auth attempts' }, 429);
      return response;
    }

    authFailures.registerSuccess(ip);

    const bodyLimit = isAgentWriteRequest(c.req.method, c.req.path)
      ? MAX_AGENT_WRITE_BODY_BYTES
      : MAX_BODY_BYTES;
    const bufferedRequest = await bufferRequestWithinLimit(c.req.raw, bodyLimit);
    if (!bufferedRequest) {
      return c.json({ error: 'Request body too large' }, 413);
    }
    c.req.raw = bufferedRequest;

    await next();
    return c.res;
  });

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      api_version: LOCAL_API_VERSION,
      timestamp: new Date().toISOString(),
      ...(deps.startedAt ? { started_at: deps.startedAt } : {}),
    });
  });

  app.get('/machine', (c) => {
    if (!deps.machineId) {
      return c.json({ error: 'Machine identity unavailable' }, 503);
    }
    return c.json({
      machine_id: deps.machineId,
      protocol_version: MACHINE_PROTOCOL_VERSION,
      server_version: AGENT_SERVER_VERSION,
    });
  });

  app.get('/presentation/today-activity', async (c) => {
    const machineId = deps.machineId;
    if (!machineId) {
      return c.json({ error: 'Machine identity unavailable' }, 503);
    }

    const now = deps.presentationClock?.() ?? new Date();
    const window = deps.presentationWindow?.(now) ?? localTodayWindow(now);
    const agents = await deps.getAgents();
    const runs = deps.store.list();
    const pendingInteractions = deps.getPendingInteractions?.() ?? [];
    const assistantHomeFacts = deps.assistantHomeFacts;
    const readinessByAgent = assistantHomeFacts
      ? new Map(await Promise.all(agents.map(async (agent) => {
        const facts = await assistantHomeFacts(agent, agents);
        const assistantHome = createAssistantHomePresentation({
          machineId,
          agent,
          runs,
          pendingInteractions,
          now,
          facts,
        });
        return [agent.id, assistantHome.readiness] as const;
      })))
      : undefined;
    const input = {
      machineId,
      agents,
      runs,
      pendingInteractions,
      now,
      ...window,
      ...(readinessByAgent ? { readinessByAgent } : {}),
    };

    return c.json({
      generatedAt: now.toISOString(),
      today: createTodayPresentation(input),
      activity: createActivityPresentation(input),
    });
  });

  app.get('/presentation/assistants/:id', async (c) => {
    if (!deps.machineId) {
      return c.json({ error: 'Machine identity unavailable' }, 503);
    }
    if (!deps.assistantHomeFacts) {
      return c.json({ error: 'Assistant readiness is unavailable' }, 503);
    }
    const agents = await deps.getAgents();
    const agent = agents.find((candidate) => candidate.id === c.req.param('id'));
    if (!agent) return c.json({ error: 'Assistant not found' }, 404);
    const now = deps.presentationClock?.() ?? new Date();
    const facts = await deps.assistantHomeFacts(agent, agents);
    return c.json({
      generatedAt: now.toISOString(),
      ...createAssistantHomePresentation({
        machineId: deps.machineId,
        agent,
        runs: deps.store.listByAgent(agent.id),
        pendingInteractions: deps.getPendingInteractions?.() ?? [],
        now,
        facts,
      }),
    });
  });

  app.get('/interactions/:id', (c) => {
    if (!deps.interactions) {
      return c.json({ error: 'Interaction responses are unavailable' }, 501);
    }
    const interaction = deps.interactions.get(c.req.param('id'));
    if (!interaction) {
      return c.json({ error: 'Interaction not found', code: 'not_found' }, 404);
    }
    return c.json(projectInteraction(interaction));
  });

  app.post('/interactions/:id/reply', async (c) => {
    if (!deps.interactions) {
      return c.json({ error: 'Interaction responses are unavailable' }, 501);
    }

    const read = await readJsonBody(c);
    if (!read.ok) return read.response;
    const parsed = InteractionReplyBodySchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json({
        error: 'Invalid interaction response body',
        code: 'invalid_body',
      }, 400);
    }

    const interactionId = c.req.param('id');
    const claimed = deps.interactions.claim(interactionId, parsed.data.response);
    if (!claimed.ok) {
      switch (claimed.reason) {
        case 'not_found':
          return c.json({ error: 'Interaction not found', code: claimed.reason }, 404);
        case 'expired':
          return c.json({ error: 'This request has expired', code: claimed.reason }, 410);
        case 'not_pending':
          return c.json({ error: 'This request is no longer pending', code: claimed.reason }, 409);
        case 'invalid_response':
          return c.json({ error: 'The response is not valid for this request', code: claimed.reason }, 422);
      }
    }

    try {
      const runId = await deps.triggerRun(
        claimed.claim.replyAgentId,
        claimed.claim.response.value,
      );
      deps.interactions.complete(interactionId, claimed.claim.claimToken);
      return c.json({
        interaction_id: interactionId,
        run_id: runId,
        status: 'accepted',
      }, 202);
    } catch (error) {
      deps.interactions.restore(interactionId, claimed.claim.claimToken);
      console.error(`[api] Interaction response was not accepted: ${sanitizeText(toErrorMessage(error), 300)}`);
      return c.json({
        error: 'The response was not accepted. Try again.',
        code: 'run_not_accepted',
      }, 503);
    }
  });

  if (deps.analysisApi) app.route('/', deps.analysisApi);
  if (deps.guidanceApi) app.route('/', deps.guidanceApi);

  const getEnv = deps.getEnv ?? ((): EnvSource => process.env);

  // Agents served over HTTP get secrets masked and a derived `capabilities`
  // array so clients can render consumer-friendly toggles without knowing
  // YAML semantics.
  const getConnections = (): DiscoveredConnection[] => deps.connections?.get().servers ?? [];

  function selectedExecutor(agent: AgentConfig): AgentExecutor {
    return agent.executor ?? 'claude-code';
  }

  function runtimeConnections(executor: AgentExecutor): DiscoveredConnection[] {
    return executor === 'claude-code' ? getConnections() : [];
  }

  async function enrichAgent(
    agent: AgentConfig,
    allAgents: AgentConfig[],
  ): Promise<Record<string, unknown>> {
    await deps.connections?.ensure?.();
    const environment = getEnv();
    const executor = selectedExecutor(agent);
    const discovered = runtimeConnections(executor);
    const registry = buildServiceRegistry({
      agents: allAgents,
      environment,
      discovered,
      executor,
    });
    return {
      ...redactAgentSecrets(agent),
      capabilities: deriveCapabilities(
        agent,
        environment,
        discovered,
        availableConnections(registry),
      ),
    };
  }

  function agentWriteErrorResponse(c: Context, err: unknown): Response {
    if (err instanceof AgentWriteError) {
      switch (err.code) {
        case 'not_found':
          return c.json({ error: err.message }, 404);
        case 'already_exists':
          return c.json({ error: err.message }, 409);
        case 'missing_env':
          return c.json({ error: err.message, missing_env: err.missingEnv ?? [] }, 409);
        case 'invalid':
          return c.json({ error: err.message }, 400);
      }
    }
    const message = toErrorMessage(err);
    console.error(`[api] Agent write failed: ${sanitizeText(message, 300)}`);
    return c.json({ error: 'Agent write failed' }, 500);
  }

  async function readJsonBody(c: Context): Promise<
    { ok: true; body: unknown } | { ok: false; response: Response }
  > {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json')) {
      return { ok: false, response: c.json({ error: 'Expected Content-Type: application/json' }, 415) };
    }
    try {
      return { ok: true, body: JSON.parse(await c.req.text()) as unknown };
    } catch {
      return { ok: false, response: c.json({ error: 'Invalid JSON body' }, 400) };
    }
  }

  app.get('/agents', async (c) => {
    const agents = await deps.getAgents();
    return c.json(await Promise.all(agents.map((agent) => enrichAgent(agent, agents))));
  });

  app.get('/agents/:id', async (c) => {
    const agents = await deps.getAgents();
    const agent = agents.find((a) => a.id === c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json(await enrichAgent(agent, agents));
  });

  app.get('/capabilities', (c) => {
    return c.json({ capabilities: catalogSummary(getEnv()) });
  });

  app.get('/services', async (c) => {
    const requestedExecutor = c.req.query('executor');
    const executor = requestedExecutor && EXECUTOR_NAMES.includes(requestedExecutor as AgentExecutor)
      ? requestedExecutor as AgentExecutor
      : undefined;
    if (requestedExecutor && !executor) return c.json({ error: 'Unknown executor' }, 400);
    if (executor === 'claude-code') await deps.connections?.ensure?.();
    const registry = buildServiceRegistry({
      agents: await deps.getAgents(),
      environment: getEnv(),
      discovered: executor ? runtimeConnections(executor) : [],
      executor,
    });
    return c.json({ connections: registry.connections });
  });

  app.get('/connection-profiles', async (c) => {
    const connections = await deps.connectionProfiles?.list() ?? [];
    return c.json({ connections });
  });

  app.post('/connection-profiles', async (c) => {
    if (!deps.connectionProfiles) {
      return c.json({ error: 'Connection editing is not available on this server' }, 501);
    }
    const read = await readJsonBody(c);
    if (!read.ok) return read.response;
    const parsed = ConnectionProfileDraftSchema.safeParse(read.body);
    if (!parsed.success) return c.json({ error: 'Invalid connection profile' }, 400);
    try {
      return c.json(await deps.connectionProfiles.create(parsed.data), 201);
    } catch (error) {
      console.error(`[api] Connection profile write failed: ${sanitizeText(toErrorMessage(error), 300)}`);
      return c.json({ error: 'Connection profile could not be saved' }, 500);
    }
  });

  app.patch('/connection-profiles/:id', async (c) => {
    if (!deps.connectionProfiles) {
      return c.json({ error: 'Connection editing is not available on this server' }, 501);
    }
    const read = await readJsonBody(c);
    if (!read.ok) return read.response;
    const parsed = ConnectionLabelSchema.safeParse(read.body);
    if (!parsed.success) return c.json({ error: 'Enter a connection name' }, 400);
    try {
      return c.json(await deps.connectionProfiles.rename(c.req.param('id'), parsed.data.label));
    } catch (error) {
      console.error(`[api] Connection profile rename failed: ${sanitizeText(toErrorMessage(error), 300)}`);
      return c.json({ error: 'Connection could not be renamed' }, 404);
    }
  });

  app.post('/connection-profiles/:id/duplicate', async (c) => {
    if (!deps.connectionProfiles) {
      return c.json({ error: 'Connection editing is not available on this server' }, 501);
    }
    const read = await readJsonBody(c);
    if (!read.ok) return read.response;
    const parsed = ConnectionLabelSchema.safeParse(read.body);
    if (!parsed.success) return c.json({ error: 'Enter a name for the copy' }, 400);
    try {
      return c.json(
        await deps.connectionProfiles.duplicate(c.req.param('id'), parsed.data.label),
        201,
      );
    } catch (error) {
      console.error(`[api] Connection profile copy failed: ${sanitizeText(toErrorMessage(error), 300)}`);
      return c.json({ error: 'Connection could not be copied' }, 404);
    }
  });

  app.post('/connection-profiles/:id/check', async (c) => {
    if (!deps.connectionProfiles) {
      return c.json({ error: 'Connection checking is not available on this server' }, 501);
    }
    const profile = (await deps.connectionProfiles.list())
      .find(({ id }) => id === c.req.param('id'));
    if (!profile) return c.json({ error: 'Connection not found' }, 404);

    const environment = getEnv();
    const missingCredentials = profile.credentials
      .map(({ environment_variable }) => environment_variable)
      .filter((name) => !environment[name]?.trim());
    return c.json({
      status: missingCredentials.length === 0 ? 'ready' : 'needs_credentials',
      missing_credentials: missingCredentials,
    });
  });

  app.delete('/connection-profiles/:id', async (c) => {
    if (!deps.connectionProfiles) {
      return c.json({ error: 'Connection editing is not available on this server' }, 501);
    }
    const connectionID = c.req.param('id');
    const referencingAgents = (await deps.getAgents())
      .filter((agent) => Object.values(agent.connection_bindings ?? {}).includes(connectionID))
      .map(({ id, name }) => ({ id, name }));
    if (referencingAgents.length > 0) {
      const noun = referencingAgents.length === 1 ? 'agent' : 'agents';
      return c.json({
        error: `This connection is still used by ${referencingAgents.length} ${noun}.`,
        code: 'connection_in_use',
        agents: referencingAgents,
      }, 409);
    }
    try {
      await deps.connectionProfiles.remove(connectionID);
      return c.json({ success: true, connection_id: connectionID });
    } catch (error) {
      console.error(`[api] Connection profile removal failed: ${sanitizeText(toErrorMessage(error), 300)}`);
      return c.json({ error: 'Connection could not be removed' }, 404);
    }
  });

  app.put('/agents/:id', async (c) => {
    if (!deps.agentWriter) {
      return c.json({ error: 'Agent editing is not available on this server' }, 501);
    }

    const read = await readJsonBody(c);
    if (!read.ok) return read.response;

    const parsed = AgentPatchSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json({ error: `Invalid agent patch: ${parsed.error.issues[0]?.message ?? 'bad request'}` }, 400);
    }

    try {
      const updated = await deps.agentWriter.update(c.req.param('id'), parsed.data);
      const agents = await deps.getAgents();
      return c.json(await enrichAgent(updated, agents));
    } catch (err) {
      return agentWriteErrorResponse(c, err);
    }
  });

  app.post('/agents', async (c) => {
    if (!deps.agentWriter) {
      return c.json({ error: 'Agent editing is not available on this server' }, 501);
    }

    const read = await readJsonBody(c);
    if (!read.ok) return read.response;

    const parsed = NewAgentSchema.safeParse(read.body);
    if (!parsed.success) {
      return c.json({ error: `Invalid agent: ${parsed.error.issues[0]?.message ?? 'bad request'}` }, 400);
    }

    try {
      const created = await deps.agentWriter.create(parsed.data);
      const agents = await deps.getAgents();
      return c.json(await enrichAgent(created, agents), 201);
    } catch (err) {
      return agentWriteErrorResponse(c, err);
    }
  });

  app.delete('/agents/:id', async (c) => {
    if (!deps.agentWriter) {
      return c.json({ error: 'Agent editing is not available on this server' }, 501);
    }

    try {
      await deps.agentWriter.remove(c.req.param('id'));
      return c.json({ success: true, agentId: c.req.param('id') });
    } catch (err) {
      return agentWriteErrorResponse(c, err);
    }
  });

  app.post('/agents/:id/run', async (c) => {
    const ip = getClientIp(c.req.raw, { trustProxyHeaders: false });
    const triggerThrottle = triggerLimiter.consume(`${ip}:run`);
    if (!triggerThrottle.allowed) {
      c.header('Retry-After', String(triggerThrottle.retryAfterSeconds ?? 60));
      return c.json({ error: 'Too many run trigger requests' }, 429);
    }

    const agentId = c.req.param('id');
    const agents = await deps.getAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    let promptSuffix: string | undefined = undefined;
    let confirmedContentHash: string | undefined = undefined;
    const rawBody = await c.req.text();

    if (rawBody.trim().length > 0) {
      const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('application/json')) {
        return c.json({ error: 'Expected Content-Type: application/json' }, 415);
      }

      try {
        const body = JSON.parse(rawBody) as unknown;
        const parsed = TriggerRunBodySchema.safeParse(body);
        if (!parsed.success) {
          return c.json({
            error: 'Invalid request body. Expected optional "with" text and confirmed_content_hash from Security check.',
          }, 400);
        }
        promptSuffix = parsed.data.with ? sanitizePromptSuffix(parsed.data.with) : undefined;
        confirmedContentHash = parsed.data.confirmed_content_hash;
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }

    if (deps.preflightRun) {
      let preflight: PreflightResult;
      try {
        preflight = await deps.preflightRun(agentId);
      } catch (err) {
        console.error(`[api] Security preflight failed: ${sanitizeText(toErrorMessage(err), 300)}`);
        return c.json({ error: 'Security check is unavailable. Nothing was run.' }, 503);
      }
      const outcome = evaluateRunPreflight(preflight, {
        source: 'manual',
        confirmedContentHash,
      });
      if (!outcome.allowed) {
        return c.json({
          error: outcome.message,
          code: outcome.code,
          content_hash: outcome.contentHash,
          risk: preflight.risk,
        }, preflightDeniedStatus(outcome.code));
      }
    }

    try {
      const runId = confirmedContentHash
        ? await deps.triggerRun(agentId, promptSuffix, { confirmedContentHash })
        : await deps.triggerRun(agentId, promptSuffix);
      return c.json({ runId, agentId }, 202);
    } catch (err) {
      if (err instanceof RunPreflightDeniedError) {
        const { outcome } = err;
        return c.json({
          error: outcome.message,
          code: outcome.code,
          content_hash: outcome.contentHash,
        }, preflightDeniedStatus(outcome.code));
      }
      const message = toErrorMessage(err);
      if (message.includes('Too many active runs')) {
        return c.json({ error: message }, 429);
      }
      return c.json({ error: 'Failed to trigger run' }, 500);
    }
  });

  app.post('/agents/:id/safe-test', async (c) => {
    if (!deps.triggerSafeTest) return c.json({ error: 'Safe testing is unavailable.' }, 501);
    const ip = getClientIp(c.req.raw, { trustProxyHeaders: false });
    const triggerThrottle = triggerLimiter.consume(`${ip}:safe-test`);
    if (!triggerThrottle.allowed) {
      c.header('Retry-After', String(triggerThrottle.retryAfterSeconds ?? 60));
      return c.json({ error: 'Too many run trigger requests' }, 429);
    }
    const agentId = c.req.param('id');
    if (!(await deps.getAgents()).some((agent) => agent.id === agentId)) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    try {
      const runId = await deps.triggerSafeTest(agentId);
      return c.json({ runId, agentId, mode: 'safe_test' }, 202);
    } catch (error) {
      if (error instanceof Error
        && 'code' in error
        && error.code === 'safe_test_unavailable') {
        return c.json({ error: error.message, code: 'safe_test_unavailable' }, 409);
      }
      return c.json({ error: 'Failed to trigger safe test' }, 500);
    }
  });

  app.get('/runs', (c) => {
    const agentId = c.req.query('agent_id');
    const runs = agentId ? deps.store.listByAgent(agentId) : deps.store.list();
    return c.json(runs.map(normalizeStoredRun));
  });

  app.get('/runs/:id/review', async (c) => {
    const run = deps.store.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    const now = deps.presentationClock?.() ?? new Date();
    const pendingInteraction = deps.getPendingInteractions?.().find(
      (interaction) => interaction.runId === run.runId && interaction.agentId === run.agentId,
    );
    return c.json(createRunReview({
      run,
      now,
      ...(pendingInteraction ? { pendingInteraction } : {}),
    }));
  });

  app.get('/runs/:id', (c) => {
    const run = deps.store.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(normalizeStoredRun(run));
  });

  const emptySnapshot: ConnectionSnapshot = { servers: [], discovered_at: null };

  // The connectors the Claude runtime can reach (account connectors + injected
  // local servers). A regenerable cache of what's available, never config.
  // GET reads the cached snapshot; POST /connections/refresh re-probes.
  app.get('/connections', (c) => {
    return c.json(deps.connections?.get() ?? emptySnapshot);
  });

  app.post('/connections/refresh', async (c) => {
    if (!deps.connections) return c.json(emptySnapshot);
    try {
      return c.json(await deps.connections.refresh());
    } catch (err) {
      console.error(`[api] Connection refresh failed: ${sanitizeText(String(err), 300)}`);
      return c.json(deps.connections.get());
    }
  });

  // Back-compat alias for older clients that expect `{ servers }`.
  app.get('/connections/discover', (c) => {
    return c.json({ servers: deps.connections?.get().servers ?? [] });
  });

  // Per-agent run metrics (success rate, avg duration, cost, last run) computed
  // from the durable run store. Local, no panel. Filter to one agent with
  // ?agent_id=.
  app.get('/metrics', (c) => {
    const agentId = c.req.query('agent_id');
    const runs = agentId ? deps.store.listByAgent(agentId) : deps.store.list();
    return c.json({ metrics: computeAgentMetrics(runs) });
  });

  // Pending decisions the daemon learned about over Supabase Realtime. Served
  // locally so the macOS app reads them from the daemon (like runs/agents)
  // instead of polling the panel. Empty when no panel is configured.
  app.get('/decisions', (c) => {
    return c.json({ decisions: deps.getPendingDecisions?.() ?? [] });
  });

  app.post('/cleanup', async (c) => {
    if (!deps.cleanupFn) {
      return c.json({ error: 'Cleanup not configured (no panel URL)' }, 501);
    }

    try {
      const cleaned = await deps.cleanupFn();
      return c.json({ ok: true, cleaned });
    } catch (err) {
      const message = toErrorMessage(err);
      return c.json({ error: `Cleanup failed: ${message}` }, 502);
    }
  });

  app.delete('/runs/:id', (c) => {
    const runId = c.req.param('id');
    const existed = deps.store.delete(runId);
    if (!existed) return c.json({ error: 'Run not found' }, 404);
    return c.json({ success: true, runId });
  });

  app.post('/runs/:id/cancel', (c) => {
    const runId = c.req.param('id');
    const run = deps.store.get(runId);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    if (run.status !== 'running') return c.json({ error: 'Run is not running' }, 409);

    const cancelled = deps.cancelRun?.(runId) ?? false;
    if (!cancelled) {
      deps.store.update(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: 'Cancelled (orphaned run)',
        code: USER_CANCELED_CODE,
      });
    }

    return c.json({ status: 'cancelled', runId });
  });

  return app;
}
