import Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig } from '../agents/config.js';

export type RouteResult =
  | { type: 'route'; agent: AgentConfig; context: string }
  | { type: 'list'; context: string }
  | { type: 'none'; context: string };

type ParsedResponse =
  | { type: 'route'; agent: AgentConfig }
  | { type: 'list' }
  | { type: 'none' };

type CreateMessageFn = (params: {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
}) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export function buildRoutingPrompt(message: string, agents: AgentConfig[]): string {
  const agentList = agents
    .map((a) => `- ${a.id}: ${a.description ?? a.name}`)
    .join('\n');

  return [
    'You are a message router. Given a user message and a list of available agents, respond with ONLY the agent ID that best matches the request.',
    '',
    'If the user is asking about capabilities, what agents are available, or what you can do, respond with LIST.',
    'If no agent matches, respond with NONE.',
    '',
    'Available agents:',
    agentList,
    '',
    `User message: ${message}`,
    '',
    'Respond with just the agent ID, LIST, or NONE. No explanation.',
  ].join('\n');
}

export function parseRoutingResponse(response: string, agents: AgentConfig[]): ParsedResponse {
  const cleaned = response.trim();
  if (cleaned === 'LIST') return { type: 'list' };
  if (cleaned === 'NONE') return { type: 'none' };

  const agent = agents.find((a) => a.id === cleaned);
  if (!agent) return { type: 'none' };

  return { type: 'route', agent };
}

let cachedClient: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!cachedClient) {
    cachedClient = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }
  return cachedClient;
}

function createDefaultCreateMessage(apiKey?: string): CreateMessageFn {
  return async (params) => {
    const response = await getClient(apiKey).messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages as Array<{ role: 'user' | 'assistant'; content: string }>,
    });
    return {
      content: response.content.map((block) => ({
        type: block.type,
        ...('text' in block ? { text: block.text } : {}),
      })),
    };
  };
}

type RouteMessageOptions = {
  create?: CreateMessageFn;
  apiKey?: string;
};

const CAPABILITY_QUERY = /\b(what can you|what do you do|which agents|list (the )?agents|what agents|who are you|help|capabilities)\b/i;

/**
 * A keyless router used when no metered Anthropic key is available (the common
 * case for subscription-only users). It can't reason like the LLM, but it
 * covers the everyday shapes: a capability question -> list; a single agent ->
 * that agent; a message that names an agent -> that agent. Anything ambiguous
 * across multiple agents falls through to `none` rather than guessing.
 */
export function heuristicRoute(message: string, agents: AgentConfig[]): RouteResult {
  if (CAPABILITY_QUERY.test(message)) return { type: 'list', context: message };

  const lower = message.toLowerCase();
  const named = agents.find(
    (a) => lower.includes(a.id.toLowerCase()) || lower.includes(a.name.toLowerCase()),
  );
  if (named) return { type: 'route', agent: named, context: message };

  const enabled = agents.filter((a) => a.enabled !== false);
  if (enabled.length === 1) return { type: 'route', agent: enabled[0], context: message };

  return { type: 'none', context: message };
}

async function runLlmRoute(
  create: CreateMessageFn,
  message: string,
  agents: AgentConfig[],
): Promise<RouteResult> {
  const prompt = buildRoutingPrompt(message, agents);
  const response = await create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  const parsed = parseRoutingResponse(text, agents);
  if (parsed.type === 'route') {
    return { type: 'route', agent: parsed.agent, context: message };
  }
  return { ...parsed, context: message };
}

export async function routeMessage(
  message: string,
  agents: AgentConfig[],
  createOrOptions?: CreateMessageFn | RouteMessageOptions,
): Promise<RouteResult> {
  const opts: RouteMessageOptions = typeof createOrOptions === 'function'
    ? { create: createOrOptions }
    : createOrOptions ?? {};

  // Explicit create fn (tests / custom transports) always wins.
  if (opts.create) return runLlmRoute(opts.create, message, agents);

  // No metered key -> don't hit the Anthropic API; route heuristically so
  // subscription-only users still get inbound chat routing.
  if (!opts.apiKey) return heuristicRoute(message, agents);

  try {
    return await runLlmRoute(createDefaultCreateMessage(opts.apiKey), message, agents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[router] LLM routing failed, falling back to heuristic: ${msg}`);
    return heuristicRoute(message, agents);
  }
}
