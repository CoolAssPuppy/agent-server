import { describe, expect, it } from 'vitest';
import { createDefaultExecutorRegistry } from './default-executors.js';

describe('default executor registry', () => {
  it('offers Claude Code, Codex, and Kimi Code with Claude as the default', () => {
    const registry = createDefaultExecutorRegistry();

    expect(registry.list()).toEqual(['claude-code', 'codex', 'kimi-code']);
    expect(registry.get()).toBe(registry.get('claude-code'));
    expect(registry.get('kimi-code')).toBeTypeOf('function');
  });
});
