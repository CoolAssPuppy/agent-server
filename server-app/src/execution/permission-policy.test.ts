import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  effectiveWorkingDirectory,
  hasEffectiveNetworkAccess,
  isToolPermitted,
} from './permission-policy.js';

describe('effective permission policy', () => {
  it('uses the glob-aware permissions allowlist as the authoritative tool gate', () => {
    const agent = makeAgent({ permissions: { allow: ['Read', 'mcp__github__list_*'], deny: [] } });
    expect(isToolPermitted(agent, 'Read')).toBe(true);
    expect(isToolPermitted(agent, 'Write')).toBe(false);
    expect(isToolPermitted(agent, 'mcp__github__list_issues')).toBe(true);
  });

  it('uses the home directory when no working directory is configured', () => {
    expect(effectiveWorkingDirectory(makeAgent({ working_directory: undefined }), '/Users/tester'))
      .toBe('/Users/tester');
  });

  it('distinguishes local stdio MCP from remote access', () => {
    expect(hasEffectiveNetworkAccess(makeAgent({
      tools: ['Read'],
      mcp_servers: { local: { command: 'local-helper' } },
    }))).toBe(false);
    expect(hasEffectiveNetworkAccess(makeAgent({
      tools: ['Read'],
      mcp_servers: { remote: { type: 'http', url: 'https://mcp.example.com' } },
    }))).toBe(true);
  });
});
