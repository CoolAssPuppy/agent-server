import { InteractionRequestSchema, type InteractionRequest } from './schema.js';

const INTERACTION_BLOCK = /```interaction\s*\n([\s\S]*?)```/;

export function parseInteractionBlock(text: string): InteractionRequest | undefined {
  const match = INTERACTION_BLOCK.exec(text);
  if (!match) return undefined;

  const jsonStr = match[1].trim();

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    const result = InteractionRequestSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
