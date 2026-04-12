import Anthropic from '@anthropic-ai/sdk';
export function buildRoutingPrompt(message, agents) {
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
export function parseRoutingResponse(response, agents) {
    const cleaned = response.trim();
    if (cleaned === 'LIST')
        return { type: 'list' };
    if (cleaned === 'NONE')
        return { type: 'none' };
    const agent = agents.find((a) => a.id === cleaned);
    if (!agent)
        return { type: 'none' };
    return { type: 'route', agent };
}
let cachedClient = null;
function getClient(apiKey) {
    if (!cachedClient) {
        cachedClient = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    }
    return cachedClient;
}
function createDefaultCreateMessage(apiKey) {
    return async (params) => {
        const response = await getClient(apiKey).messages.create({
            model: params.model,
            max_tokens: params.max_tokens,
            messages: params.messages,
        });
        return {
            content: response.content.map((block) => ({
                type: block.type,
                ...('text' in block ? { text: block.text } : {}),
            })),
        };
    };
}
export async function routeMessage(message, agents, createOrOptions) {
    const opts = typeof createOrOptions === 'function'
        ? { create: createOrOptions }
        : createOrOptions ?? {};
    const create = opts.create ?? createDefaultCreateMessage(opts.apiKey);
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
//# sourceMappingURL=router.js.map