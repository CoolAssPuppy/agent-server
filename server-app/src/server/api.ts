import { Hono, type Context } from 'hono';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import {
  catalogSummary,
  deriveCapabilities,
  redactAgentSecrets,
} from '../agents/capabilities.js';
import {
  AgentPatchSchema,
  AgentWriteError,
  NewAgentSchema,
  type AgentWriter,
} from '../agents/writer.js';
import type { RunStore } from '../reporting/store.js';
import type { PendingDecision } from '../reporting/realtime-client.js';
import {
  AuthFailureTracker,
  InMemoryRateLimiter,
  getClientIp,
  sanitizePromptSuffix,
  sanitizeStoredRun,
  sanitizeText,
} from './security-utils.js';

type EnvSource = Record<string, string | undefined>;

type ApiDependencies = {
  getAgents: () => Promise<AgentConfig[]>;
  store: RunStore;
  triggerRun: (agentId: string, promptSuffix?: string) => Promise<string>;
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
  apiKey?: string;
  startedAt?: string;
  host?: string;
};

const MAX_BODY_BYTES = 8_192;
// Agent definitions carry the full prompt (up to 40k chars), so create and
// update bodies need far more headroom than the other routes.
const MAX_AGENT_WRITE_BODY_BYTES = 256 * 1024;
const TriggerRunBodySchema = z.object({
  with: z.string().trim().max(4_000).optional(),
});

function isAgentWriteRequest(method: string, path: string): boolean {
  if (method === 'POST' && path === '/agents') return true;
  return method === 'PUT' && /^\/agents\/[^/]+$/.test(path);
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

function setSecurityHeaders(headers: Headers): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', 'no-store');
}

function parseContentLength(request: Request): number | undefined {
  const value = request.headers.get('content-length');
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

  const generalLimiter = new InMemoryRateLimiter(180, 60_000);
  const triggerLimiter = new InMemoryRateLimiter(20, 60_000);
  const authFailures = new AuthFailureTracker(10, 10 * 60_000);

  app.use(async (c, next) => {
    const ip = getClientIp(c.req.raw, { trustProxyHeaders: false });

    const throttle = generalLimiter.consume(ip);
    if (!throttle.allowed) {
      c.header('Retry-After', String(throttle.retryAfterSeconds ?? 60));
      const response = c.json({ error: 'Too many requests' }, 429);
      setSecurityHeaders(response.headers);
      return response;
    }

    const blocked = authFailures.isBlocked(ip);
    if (!blocked.allowed) {
      c.header('Retry-After', String(blocked.retryAfterSeconds ?? 60));
      const response = c.json({ error: 'Too many failed auth attempts' }, 429);
      setSecurityHeaders(response.headers);
      return response;
    }

    const bodyLimit = isAgentWriteRequest(c.req.method, c.req.path)
      ? MAX_AGENT_WRITE_BODY_BYTES
      : MAX_BODY_BYTES;
    const contentLength = parseContentLength(c.req.raw);
    if (contentLength !== undefined && contentLength > bodyLimit) {
      const response = c.json({ error: 'Request body too large' }, 413);
      setSecurityHeaders(response.headers);
      return response;
    }

    const isMutationRequest = c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
    if (isMutationRequest && !isSameOriginRequest(c.req.raw, deps.host)) {
      console.warn(`[api] Rejected cross-origin mutation from ${sanitizeText(c.req.raw.headers.get('origin') ?? 'unknown', 120)}`);
      const response = c.json({ error: 'Cross-origin mutation blocked' }, 403);
      setSecurityHeaders(response.headers);
      return response;
    }

    if (!deps.apiKey || c.req.path === '/health') {
      await next();
      if (c.res) setSecurityHeaders(c.res.headers);
      return c.res;
    }

    const requestKey = extractApiKeyHeader(c.req.raw);
    if (!isAuthorized(requestKey, deps.apiKey)) {
      const failure = authFailures.registerFailure(ip);
      console.warn(`[api] Unauthorized request from ${sanitizeText(ip, 64)} to ${sanitizeText(c.req.path, 80)}`);
      if (!failure.allowed) {
        c.header('Retry-After', String(failure.retryAfterSeconds ?? 60));
      }
      const response = c.json({ error: 'Unauthorized' }, 401);
      setSecurityHeaders(response.headers);
      return response;
    }

    authFailures.registerSuccess(ip);
    await next();
    if (c.res) setSecurityHeaders(c.res.headers);
    return c.res;
  });

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ...(deps.startedAt ? { started_at: deps.startedAt } : {}),
    });
  });

  const getEnv = deps.getEnv ?? ((): EnvSource => process.env);

  // Agents served over HTTP get secrets masked and a derived `capabilities`
  // array so clients can render consumer-friendly toggles without knowing
  // YAML semantics.
  function enrichAgent(agent: AgentConfig): Record<string, unknown> {
    return {
      ...redactAgentSecrets(agent),
      capabilities: deriveCapabilities(agent, getEnv()),
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
    const message = err instanceof Error ? err.message : String(err);
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
    return c.json(agents.map((agent) => enrichAgent(agent)));
  });

  app.get('/agents/:id', async (c) => {
    const agents = await deps.getAgents();
    const agent = agents.find((a) => a.id === c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json(enrichAgent(agent));
  });

  app.get('/capabilities', (c) => {
    return c.json({ capabilities: catalogSummary(getEnv()) });
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
      return c.json(enrichAgent(updated));
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
      return c.json(enrichAgent(created), 201);
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
          return c.json({ error: 'Invalid request body. Expected optional string field "with" (max 4000 chars).' }, 400);
        }
        promptSuffix = parsed.data.with ? sanitizePromptSuffix(parsed.data.with) : undefined;
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }

    try {
      const runId = await deps.triggerRun(agentId, promptSuffix);
      return c.json({ runId, agentId }, 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Too many active runs')) {
        return c.json({ error: message }, 429);
      }
      return c.json({ error: 'Failed to trigger run' }, 500);
    }
  });

  app.get('/runs', (c) => {
    const agentId = c.req.query('agent_id');
    const runs = agentId ? deps.store.listByAgent(agentId) : deps.store.list();
    return c.json(runs.map(sanitizeStoredRun));
  });

  app.get('/runs/:id', (c) => {
    const run = deps.store.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(sanitizeStoredRun(run));
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
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Cleanup failed: ${message}` }, 500);
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
      });
    }

    return c.json({ status: 'cancelled', runId });
  });

  return app;
}
