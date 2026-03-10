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

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

const defaultCreateMessage: CreateMessageFn = async (params) => {
  const response = await getClient().messages.create({
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

export async function routeMessage(
  message: string,
  agents: AgentConfig[],
  create: CreateMessageFn = defaultCreateMessage,
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
