import type { AgentConfig } from '../agents/config.js';
export type RouteResult = {
    type: 'route';
    agent: AgentConfig;
    context: string;
} | {
    type: 'list';
    context: string;
} | {
    type: 'none';
    context: string;
};
type ParsedResponse = {
    type: 'route';
    agent: AgentConfig;
} | {
    type: 'list';
} | {
    type: 'none';
};
type CreateMessageFn = (params: {
    model: string;
    max_tokens: number;
    messages: Array<{
        role: string;
        content: string;
    }>;
}) => Promise<{
    content: Array<{
        type: string;
        text?: string;
    }>;
}>;
export declare function buildRoutingPrompt(message: string, agents: AgentConfig[]): string;
export declare function parseRoutingResponse(response: string, agents: AgentConfig[]): ParsedResponse;
type RouteMessageOptions = {
    create?: CreateMessageFn;
    apiKey?: string;
};
export declare function routeMessage(message: string, agents: AgentConfig[], createOrOptions?: CreateMessageFn | RouteMessageOptions): Promise<RouteResult>;
export {};
//# sourceMappingURL=router.d.ts.map