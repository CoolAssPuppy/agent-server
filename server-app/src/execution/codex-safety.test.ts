import { describe, it, expect } from 'vitest';
import { deriveCodexSandbox, deriveCodexNetworkAccess, isToolPermitted } from './codex-safety.js';
import { makeAgent } from '../test-factories.js';

describe('deriveCodexSandbox', () => {
  it('defaults to workspace-write for an unrestricted agent', () => {
    expect(deriveCodexSandbox(makeAgent({ tools: [] }))).toBe('workspace-write');
  });

  it('is read-only when the agent may neither write nor run commands', () => {
    expect(deriveCodexSandbox(makeAgent({ tools: ['Read', 'Glob', 'Grep'] }))).toBe('read-only');
  });

  it('is workspace-write when the agent may write files', () => {
    expect(deriveCodexSandbox(makeAgent({ tools: ['Read', 'Write', 'Edit'] }))).toBe('workspace-write');
  });

  it('is workspace-write when the agent may run commands', () => {
    expect(deriveCodexSandbox(makeAgent({ tools: ['Read', 'Bash'] }))).toBe('workspace-write');
  });

  it('is read-only when write/exec tools are denied via disallowed_tools', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'] });
    expect(deriveCodexSandbox(agent)).toBe('read-only');
  });

  it('honors an explicit codex_sandbox over the derived value', () => {
    const agent = makeAgent({ tools: ['Read'], codex_sandbox: 'danger-full-access' });
    expect(deriveCodexSandbox(agent)).toBe('danger-full-access');
  });

  it('forces read-only in plan mode regardless of tools', () => {
    const agent = makeAgent({ tools: ['Write', 'Bash'], permission_mode: 'plan' });
    expect(deriveCodexSandbox(agent)).toBe('read-only');
  });

  it('respects a permissions allowlist: write allowed -> workspace-write', () => {
    const agent = makeAgent({ tools: [], permissions: { allow: ['Read', 'Write'], deny: [] } });
    expect(deriveCodexSandbox(agent)).toBe('workspace-write');
  });

  it('respects a permissions allowlist: read-only grant -> read-only', () => {
    const agent = makeAgent({ tools: [], permissions: { allow: ['Read', 'Grep'], deny: [] } });
    expect(deriveCodexSandbox(agent)).toBe('read-only');
  });

  it('respects a permissions deny for Bash even under a wildcard allow', () => {
    const agent = makeAgent({ tools: [], permissions: { allow: ['*'], deny: ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'] } });
    expect(deriveCodexSandbox(agent)).toBe('read-only');
  });
});

describe('deriveCodexNetworkAccess', () => {
  it('is off by default for an unrestricted agent', () => {
    expect(deriveCodexNetworkAccess(makeAgent({ tools: [] }))).toBe(false);
  });

  it('is on only when a web tool is explicitly granted', () => {
    expect(deriveCodexNetworkAccess(makeAgent({ tools: ['Read', 'WebFetch'] }))).toBe(true);
    expect(deriveCodexNetworkAccess(makeAgent({ tools: ['Read', 'WebSearch'] }))).toBe(true);
  });

  it('stays off when a web tool is granted then denied', () => {
    const agent = makeAgent({ tools: ['WebFetch'], disallowed_tools: ['WebFetch'] });
    expect(deriveCodexNetworkAccess(agent)).toBe(false);
  });

  it('follows the permissions allowlist for web tools', () => {
    expect(deriveCodexNetworkAccess(makeAgent({ tools: [], permissions: { allow: ['WebSearch'], deny: [] } }))).toBe(true);
    expect(deriveCodexNetworkAccess(makeAgent({ tools: [], permissions: { allow: ['Read'], deny: [] } }))).toBe(false);
  });
});

describe('isToolPermitted', () => {
  it('allows everything when no restrictions are set', () => {
    expect(isToolPermitted(makeAgent({ tools: [] }), 'Bash')).toBe(true);
  });

  it('restricts to the allowlist when tools is non-empty', () => {
    const agent = makeAgent({ tools: ['Read'] });
    expect(isToolPermitted(agent, 'Read')).toBe(true);
    expect(isToolPermitted(agent, 'Bash')).toBe(false);
  });

  it('denies tools listed in disallowed_tools', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: ['Bash'] });
    expect(isToolPermitted(agent, 'Bash')).toBe(false);
  });
});
