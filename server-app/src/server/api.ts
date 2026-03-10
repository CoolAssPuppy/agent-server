import { Hono } from 'hono';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import type { RunStore } from '../reporting/store.js';

type ApiDependencies = {
  getAgents: () => Promise<AgentConfig[]>;
  store: RunStore;
  triggerRun: (agentId: string, promptSuffix?: string) => Promise<string>;
  cancelRun?: (runId: string) => boolean;
  apiKey?: string;
};

const TriggerRunBodySchema = z.object({
  with: z.string().trim().max(4_000).optional(),
});

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

export function createApi(deps: ApiDependencies): Hono {
  const app = new Hono();

  app.use(async (c, next) => {
    if (!deps.apiKey || c.req.path === '/health') {
      await next();
      return;
    }

    const requestKey = extractApiKeyHeader(c.req.raw);
    if (!isAuthorized(requestKey, deps.apiKey)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  });

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/agents', async (c) => {
    const agents = await deps.getAgents();
    return c.json(agents);
  });

  app.get('/agents/:id', async (c) => {
    const agents = await deps.getAgents();
    const agent = agents.find((a) => a.id === c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json(agent);
  });

  app.post('/agents/:id/run', async (c) => {
    const agentId = c.req.param('id');
    const agents = await deps.getAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    let promptSuffix: string | undefined = undefined;
    const rawBody = await c.req.text();

    if (rawBody.trim().length > 0) {
      try {
        const body = JSON.parse(rawBody) as unknown;
        const parsed = TriggerRunBodySchema.safeParse(body);
        if (!parsed.success) {
          return c.json({ error: 'Invalid request body. Expected optional string field "with" (max 4000 chars).' }, 400);
        }
        promptSuffix = parsed.data.with;
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }

    const runId = await deps.triggerRun(agentId, promptSuffix);
    return c.json({ runId, agentId }, 202);
  });

  app.get('/runs', (c) => {
    const agentId = c.req.query('agent_id');
    const runs = agentId ? deps.store.listByAgent(agentId) : deps.store.list();
    return c.json(runs);
  });

  app.get('/runs/:id', (c) => {
    const run = deps.store.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(run);
  });

  app.post('/runs/:id/cancel', (c) => {
    const runId = c.req.param('id');
    const run = deps.store.get(runId);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    if (run.status !== 'running') return c.json({ error: 'Run is not running' }, 409);

    const cancelled = deps.cancelRun?.(runId) ?? false;
    if (!cancelled) return c.json({ error: 'Run not found' }, 404);

    return c.json({ status: 'cancelled', runId });
  });

  return app;
}
