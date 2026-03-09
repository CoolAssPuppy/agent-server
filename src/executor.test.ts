import { describe, it, expect, vi } from 'vitest';
import {
  parseStreamEvent,
  summarizeTurn,
  type ClaudeStreamEvent,
  type ExecutionResult,
} from './executor.js';

describe('parseStreamEvent', () => {
  it('parses a valid JSON line', () => {
    const line = '{"type":"assistant","message":"Hello"}';
    const event = parseStreamEvent(line);
    expect(event).toEqual({ type: 'assistant', message: 'Hello' });
  });

  it('returns null for empty lines', () => {
    expect(parseStreamEvent('')).toBeNull();
    expect(parseStreamEvent('  ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseStreamEvent('not json')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseStreamEvent('"just a string"')).toBeNull();
    expect(parseStreamEvent('42')).toBeNull();
  });
});

describe('summarizeTurn', () => {
  it('extracts text from assistant message', () => {
    const event: ClaudeStreamEvent = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Found 3 results' }] },
    };
    expect(summarizeTurn(event)).toBe('Found 3 results');
  });

  it('extracts tool name from tool_use content', () => {
    const event: ClaudeStreamEvent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test.ts' } },
        ],
      },
    };
    expect(summarizeTurn(event)).toBe('Using tool: Read');
  });

  it('extracts text from result events', () => {
    const event: ClaudeStreamEvent = {
      type: 'result',
      result: 'Task completed successfully',
    };
    expect(summarizeTurn(event)).toBe('Task completed successfully');
  });

  it('returns null for unknown event types', () => {
    const event: ClaudeStreamEvent = { type: 'system', data: {} };
    expect(summarizeTurn(event)).toBeNull();
  });

  it('truncates long messages', () => {
    const longText = 'A'.repeat(300);
    const event: ClaudeStreamEvent = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: longText }] },
    };
    const summary = summarizeTurn(event);
    expect(summary!.length).toBeLessThanOrEqual(203);
    expect(summary!.endsWith('...')).toBe(true);
  });

  it('handles multiple content blocks by joining text', () => {
    const event: ClaudeStreamEvent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First part.' },
          { type: 'tool_use', name: 'Bash', input: {} },
          { type: 'text', text: 'Second part.' },
        ],
      },
    };
    const summary = summarizeTurn(event);
    expect(summary).toContain('First part.');
  });
});
