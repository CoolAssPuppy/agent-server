import {
  InteractionRequestSchema,
  DecisionSchema,
  type InteractionRequest,
  type DecisionInput,
} from './schema.js';

const INTERACTION_BLOCK = /```interaction\s*\n([\s\S]*?)```/;
const DECISION_BLOCK = /```decision\s*\n([\s\S]*?)```/;

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

export function parseDecisionBlock(text: string): DecisionInput | undefined {
  const match = DECISION_BLOCK.exec(text);
  if (!match) return undefined;

  const jsonStr = match[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return undefined;
  }

  const result = DecisionSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[decision-parser] Invalid decision block:', result.error.message);
    return undefined;
  }
  return result.data;
}
