import { describe, it, expect } from 'vitest';
import { extractWatchConfigs } from './file-watcher.js';
import { makeAgent } from '../test-factories.js';

describe('extractWatchConfigs', () => {
  it('extracts watch configs from agents with file watches', () => {
    const agents = [
      makeAgent({
        id: 'watcher-agent',
        watch: [{ path: '/tmp/output.md' }, { path: '/tmp/data/', glob: '*.json' }],
      }),
      makeAgent({ id: 'no-watch-agent' }),
    ];

    const configs = extractWatchConfigs(agents);
    expect(configs).toHaveLength(2);
    expect(configs[0]).toEqual({ path: '/tmp/output.md', agentId: 'watcher-agent' });
    expect(configs[1]).toEqual({ path: '/tmp/data/', agentId: 'watcher-agent', glob: '*.json' });
  });

  it('returns empty array when no agents have watches', () => {
    const agents = [makeAgent(), makeAgent({ id: 'other' })];
    expect(extractWatchConfigs(agents)).toEqual([]);
  });

  it('skips disabled agents', () => {
    const agents = [
      makeAgent({
        id: 'disabled-watcher',
        enabled: false,
        watch: [{ path: '/tmp/output.md' }],
      }),
    ];

    expect(extractWatchConfigs(agents)).toEqual([]);
  });

  it('expands ~ in watch paths', () => {
    const agents = [
      makeAgent({
        id: 'home-watcher',
        watch: [{ path: '~/Documents/notes.md' }],
      }),
    ];

    const configs = extractWatchConfigs(agents);
    expect(configs[0].path).not.toContain('~');
    expect(configs[0].path).toContain('/Documents/notes.md');
  });
});
