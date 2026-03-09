import { Hono } from 'hono';
import type { AgentConfig } from './agent-config.js';
import type { RunStore } from './store.js';

type ApiDependencies = {
  getAgents: () => Promise<AgentConfig[]>;
  store: RunStore;
  triggerRun: (agentId: string) => Promise<string>;
};

export function createApi(deps: ApiDependencies): Hono {
  const app = new Hono();

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

    const runId = await deps.triggerRun(agentId);
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

  return app;
}
