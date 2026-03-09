import { describe, it, expect } from 'vitest';
import { buildRoutingPrompt, parseRoutingResponse, routeMessage } from './router.js';
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
});

describe('parseRoutingResponse', () => {
  it('returns the matched agent for a clean response', () => {
    const restaurantAgent = makeAgent({ id: 'restaurant-checker' });
    const agents = [restaurantAgent, makeAgent({ id: 'daily-standup' })];

    expect(parseRoutingResponse('restaurant-checker', agents)).toBe(restaurantAgent);
  });

  it('returns undefined when response is NONE', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    expect(parseRoutingResponse('NONE', agents)).toBeUndefined();
  });

  it('returns undefined when response does not match any agent', () => {
    const agents = [makeAgent({ id: 'test-agent' })];
    expect(parseRoutingResponse('nonexistent-agent', agents)).toBeUndefined();
  });

  it('trims whitespace from response', () => {
    const agent = makeAgent({ id: 'daily-standup' });
    const agents = [agent];
    expect(parseRoutingResponse('  daily-standup  \n', agents)).toBe(agent);
  });
});

describe('routeMessage', () => {
  it('returns the matched agent and the original message as context', async () => {
    const restaurantAgent = makeAgent({ id: 'restaurant-checker', description: 'Checks restaurant availability' });
    const agents = [
      restaurantAgent,
      makeAgent({ id: 'daily-standup', description: 'Generates standup summaries' }),
    ];

    const result = await routeMessage('Check Bougainville tonight for 4', agents, mockCreate('restaurant-checker'));

    expect(result.agent).toBe(restaurantAgent);
    expect(result.context).toBe('Check Bougainville tonight for 4');
  });

  it('returns undefined agent when no agent matches', async () => {
    const agents = [makeAgent({ id: 'daily-standup' })];

    const result = await routeMessage('What is the meaning of life?', agents, mockCreate('NONE'));
    expect(result.agent).toBeUndefined();
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
});
