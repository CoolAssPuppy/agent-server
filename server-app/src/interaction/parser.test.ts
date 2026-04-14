import { describe, it, expect } from 'vitest';
import { parseInteractionBlock, parseDecisionBlock } from './parser.js';

describe('parseInteractionBlock', () => {
  it('extracts a valid interaction block from text', () => {
    const text = `I found some availability.

\`\`\`interaction
{
  "message": "Found 3 slots at Bougainville",
  "options": [
    { "label": "19:00", "value": "Book 19:00" },
    { "label": "20:30", "value": "Book 20:30" }
  ]
}
\`\`\`

Let me know which one you prefer.`;

    const result = parseInteractionBlock(text);
    expect(result).toBeDefined();
    expect(result!.message).toBe('Found 3 slots at Bougainville');
    expect(result!.options).toHaveLength(2);
    expect(result!.options![0].label).toBe('19:00');
    expect(result!.options![1].value).toBe('Book 20:30');
  });

  it('returns null when no interaction block is present', () => {
    const text = 'Just a normal response with no interaction needed.';
    expect(parseInteractionBlock(text)).toBeUndefined();
  });

  it('returns null for malformed JSON in the block', () => {
    const text = `\`\`\`interaction
{ not valid json }
\`\`\``;
    expect(parseInteractionBlock(text)).toBeUndefined();
  });

  it('returns null when JSON is valid but does not match schema', () => {
    const text = `\`\`\`interaction
{ "wrong_field": "value" }
\`\`\``;
    expect(parseInteractionBlock(text)).toBeUndefined();
  });

  it('parses a free-text interaction request', () => {
    const text = `\`\`\`interaction
{
  "message": "What is your budget?",
  "freeText": true
}
\`\`\``;

    const result = parseInteractionBlock(text);
    expect(result).toBeDefined();
    expect(result!.message).toBe('What is your budget?');
    expect(result!.freeText).toBe(true);
    expect(result!.options).toBeUndefined();
  });

  it('handles block with extra whitespace', () => {
    const text = `\`\`\`interaction
  {
    "message": "Pick one",
    "options": [{ "label": "A", "value": "a" }]
  }
\`\`\``;

    const result = parseInteractionBlock(text);
    expect(result).toBeDefined();
    expect(result!.options).toHaveLength(1);
  });

  it('extracts only the first interaction block if multiple exist', () => {
    const text = `\`\`\`interaction
{ "message": "First", "freeText": true }
\`\`\`

\`\`\`interaction
{ "message": "Second", "freeText": true }
\`\`\``;

    const result = parseInteractionBlock(text);
    expect(result).toBeDefined();
    expect(result!.message).toBe('First');
  });

  it('ignores non-interaction fenced blocks', () => {
    const text = `Here is some code:

\`\`\`json
{ "message": "This is not an interaction" }
\`\`\`

Just regular output.`;

    expect(parseInteractionBlock(text)).toBeUndefined();
  });
});

describe('parseDecisionBlock', () => {
  it('extracts a valid approve decision block', () => {
    const text = `Thinking about it.

\`\`\`decision
{
  "type": "approve",
  "title": "Approve purchase?",
  "body": "The vendor quoted $1,200.",
  "approve_label": "Approve",
  "decline_label": "Decline"
}
\`\`\`
`;
    const result = parseDecisionBlock(text);
    expect(result).toBeDefined();
    expect(result!.type).toBe('approve');
    expect(result!.title).toBe('Approve purchase?');
  });

  it('extracts a valid pick decision block', () => {
    const text = `\`\`\`decision
{
  "type": "pick",
  "title": "Pick a slot",
  "options": [
    { "id": "slot_1", "label": "19:00" },
    { "id": "slot_2", "label": "20:30" }
  ]
}
\`\`\``;
    const result = parseDecisionBlock(text);
    expect(result).toBeDefined();
    expect(result!.type).toBe('pick');
    if (result!.type === 'pick') {
      expect(result!.options).toHaveLength(2);
    }
  });

  it('returns undefined when no decision block is present', () => {
    expect(parseDecisionBlock('just plain text')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    const text = `\`\`\`decision
{ not valid json }
\`\`\``;
    expect(parseDecisionBlock(text)).toBeUndefined();
  });

  it('returns undefined when schema validation fails', () => {
    const text = `\`\`\`decision
{ "type": "approve" }
\`\`\``;
    expect(parseDecisionBlock(text)).toBeUndefined();
  });

  it('does not throw on random fenced blocks', () => {
    const text = '```json\n{"x":1}\n```';
    expect(() => parseDecisionBlock(text)).not.toThrow();
    expect(parseDecisionBlock(text)).toBeUndefined();
  });

  it('coexists with interaction block — decision parser ignores interaction blocks', () => {
    const text = `\`\`\`interaction
{ "message": "hi", "freeText": true }
\`\`\``;
    expect(parseDecisionBlock(text)).toBeUndefined();
    expect(parseInteractionBlock(text)).toBeDefined();
  });

  it('coexists with interaction block — interaction parser ignores decision blocks', () => {
    const text = `\`\`\`decision
{ "type": "approve", "title": "ok?" }
\`\`\``;
    expect(parseInteractionBlock(text)).toBeUndefined();
    expect(parseDecisionBlock(text)).toBeDefined();
  });
});
