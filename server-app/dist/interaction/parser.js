import { InteractionRequestSchema } from './schema.js';
const INTERACTION_BLOCK = /```interaction\s*\n([\s\S]*?)```/;
export function parseInteractionBlock(text) {
    const match = INTERACTION_BLOCK.exec(text);
    if (!match)
        return undefined;
    const jsonStr = match[1].trim();
    try {
        const parsed = JSON.parse(jsonStr);
        const result = InteractionRequestSchema.safeParse(parsed);
        return result.success ? result.data : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=parser.js.map