import { describe, it, expect } from 'vitest';
import { buildRoutingPrompt, heuristicRoute, parseRoutingResponse, routeMessage } from './router.js';
import type { AgentConfig } from '../agents/config.js';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    prompt: 'Do something.',
    tools: [],
    disallowed_tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

function mockCreate(text: string) {
  return async () => ({ content: [{ type: 'text' as const, text }] });
}

describe('buildRoutingPrompt', () => {
  it('includes agent IDs and descriptions in the prompt', () => {
    const agents = [
      makeAgent({ id: 'restaurant-checker', name: 'Restaurant Checker', description: 'Checks restaurant availability' }),
      makeAgent({ id: 'daily-standup', name: 'Daily Standup', description: 'Generates standup summaries' }),
    ];

    const prompt = buildRoutingPrompt('Check Bougainville in Lisbon', agents);

    expect(prompt).toContain('restaurant-checker');
    expect(prompt).toContain('Checks restaurant availability');
    expect(prompt).toContain('daily-standup');
    expect(prompt).toContain('Generates standup summaries');
    expect(prompt).toContain('Check Bougainville in Lisbon');
  });

  it('uses agent name when description is missing', () => {
    const agents = [
      makeAgent({ id: 'my-agent', name: 'My Cool Agent', description: undefined }),
    ];

    const prompt = buildRoutingPrompt('do something', agents);
    expect(prompt).toContain('My Cool Agent');
  });

  it('includes LIST instruction for capability queries', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    const prompt = buildRoutingPrompt('what can you do?', agents);
    expect(prompt).toContain('LIST');
  });
});

describe('parseRoutingResponse', () => {
  it('returns a route result for a matched agent', () => {
    const restaurantAgent = makeAgent({ id: 'restaurant-checker' });
    const agents = [restaurantAgent, makeAgent({ id: 'daily-standup' })];

    const result = parseRoutingResponse('restaurant-checker', agents);
    expect(result).toEqual({ type: 'route', agent: restaurantAgent });
  });

  it('returns a none result when response is NONE', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    const result = parseRoutingResponse('NONE', agents);
    expect(result).toEqual({ type: 'none' });
  });

  it('returns a none result when response does not match any agent', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    const result = parseRoutingResponse('nonexistent-agent', agents);
    expect(result).toEqual({ type: 'none' });
  });

  it('trims whitespace from response', () => {
    const agent = makeAgent({ id: 'daily-standup' });
    const agents = [agent];
    const result = parseRoutingResponse('  daily-standup  \n', agents);
    expect(result).toEqual({ type: 'route', agent });
  });

  it('returns a list result when response is LIST', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    const result = parseRoutingResponse('LIST', agents);
    expect(result).toEqual({ type: 'list' });
  });

  it('returns a list result when response is LIST with whitespace', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    const result = parseRoutingResponse('  LIST\n', agents);
    expect(result).toEqual({ type: 'list' });
  });
});

describe('routeMessage', () => {
  it('returns a route result with the matched agent and context', async () => {
    const restaurantAgent = makeAgent({ id: 'restaurant-checker', description: 'Checks restaurant availability' });
    const agents = [
      restaurantAgent,
      makeAgent({ id: 'daily-standup', description: 'Generates standup summaries' }),
    ];

    const result = await routeMessage('Check Bougainville tonight for 4', agents, mockCreate('restaurant-checker'));

    expect(result).toEqual({
      type: 'route',
      agent: restaurantAgent,
      context: 'Check Bougainville tonight for 4',
    });
  });

  it('returns a none result when no agent matches', async () => {
    const agents = [makeAgent({ id: 'daily-standup' })];

    const result = await routeMessage('What is the meaning of life?', agents, mockCreate('NONE'));
    expect(result).toEqual({ type: 'none', context: 'What is the meaning of life?' });
  });

  it('returns a list result when LLM responds with LIST', async () => {
    const agents = [makeAgent({ id: 'daily-standup', description: 'Generates standup summaries' })];

    const result = await routeMessage('What can you do?', agents, mockCreate('LIST'));
    expect(result).toEqual({ type: 'list', context: 'What can you do?' });
  });

  it('passes agent list to the create function in the prompt', async () => {
    const calls: unknown[] = [];
    const trackingCreate = async (params: unknown) => {
      calls.push(params);
      return { content: [{ type: 'text' as const, text: 'NONE' }] };
    };

    const agents = [makeAgent({ id: 'my-agent', description: 'Does stuff' })];
    await routeMessage('hello', agents, trackingCreate);

    expect(calls).toHaveLength(1);
    const callArgs = calls[0] as { model: string; max_tokens: number; messages: Array<{ content: string }> };
    expect(callArgs.model).toBeDefined();
    expect(callArgs.max_tokens).toBeDefined();
    expect(callArgs.messages[0].content).toContain('my-agent');
  });

  it('routes without an API key when only one agent exists (keyless fallback)', async () => {
    const only = makeAgent({ id: 'slack-smoke', name: 'Slack Smoke Test' });
    // No create fn and no apiKey: must not hit the metered API.
    const result = await routeMessage('hey, are you connected?', [only]);
    expect(result).toEqual({ type: 'route', agent: only, context: 'hey, are you connected?' });
  });

  it('lists capabilities keylessly for a meta-question', async () => {
    const agents = [makeAgent({ id: 'a' }), makeAgent({ id: 'b' })];
    const result = await routeMessage('what can you do?', agents);
    expect(result.type).toBe('list');
  });
});

describe('heuristicRoute', () => {
  it('routes to an agent named in the message', () => {
    const agents = [
      makeAgent({ id: 'daily-standup', name: 'Daily Standup' }),
      makeAgent({ id: 'restaurant-checker', name: 'Restaurant Checker' }),
    ];
    const result = heuristicRoute('run the restaurant-checker please', agents);
    expect(result).toEqual({
      type: 'route',
      agent: agents[1],
      context: 'run the restaurant-checker please',
    });
  });

  it('returns none when several agents could match and none is named', () => {
    const agents = [makeAgent({ id: 'a' }), makeAgent({ id: 'b' })];
    expect(heuristicRoute('do the thing', agents).type).toBe('none');
  });

  it('routes on a shared word ("French quiz" -> the French/Portuguese agent)', () => {
    const agents = [
      makeAgent({ id: 'daily-focus', name: 'Daily Focus List' }),
      makeAgent({ id: 'daily-portuguese-and-french', name: 'Daily Portuguese and French' }),
      makeAgent({ id: 'cmo-coaching', name: 'CMO Coaching Report' }),
    ];
    const result = heuristicRoute('I want to do the French quiz', agents);
    expect(result.type).toBe('route');
    expect(result.type === 'route' && result.agent.id).toBe('daily-portuguese-and-french');
  });

  it('stays ambiguous when a word matches two agents equally', () => {
    const agents = [
      makeAgent({ id: 'weekly-goals-report', name: 'Weekly Goals Report' }),
      makeAgent({ id: 'weekly-status-report', name: 'Weekly Status Report' }),
      makeAgent({ id: 'daily-focus', name: 'Daily Focus List' }),
    ];
    // "weekly report" hits both weekly agents equally -> no guess.
    expect(heuristicRoute('weekly report', agents).type).toBe('none');
  });

  it('ignores disabled agents when auto-selecting the only one', () => {
    const agents = [
      makeAgent({ id: 'on' }),
      makeAgent({ id: 'off', enabled: false }),
    ];
    const result = heuristicRoute('anything', agents);
    expect(result).toEqual({ type: 'route', agent: agents[0], context: 'anything' });
  });
});
