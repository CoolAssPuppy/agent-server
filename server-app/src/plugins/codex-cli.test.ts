import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { buildScopedCodexInvocation, streamScopedCodex } from './codex-cli.js';

describe('scoped Codex CLI invocation', () => {
  it('uses permission profiles without legacy sandbox flags', () => {
    const invocation = buildScopedCodexInvocation({
      agent: makeAgent({
        executor: 'codex',
        model: 'gpt-5.4',
        working_directory: '/Users/test/Book',
        file_access: [{ path: '/Users/test/Book', kind: 'folder', access: 'read_write' }],
        tools: ['Read', 'Write', 'WebFetch'],
        permissions: { allow: ['Read', 'Write', 'WebFetch'], deny: [] },
      }),
      environment: { HOME: '/Users/test', PATH: '/usr/bin' },
      codexExecutablePath: '/opt/homebrew/bin/codex',
      config: { mcp_servers: { notes: { command: 'notes-helper', enabled: true, required: true } } },
      baseUrl: 'https://example.test/v1',
      apiKey: 'provider-key',
    });

    expect(invocation.executable).toBe('/opt/homebrew/bin/codex');
    expect(invocation.arguments).toEqual(expect.arrayContaining([
      'exec',
      '--experimental-json',
      '--ignore-user-config',
      '--model', 'gpt-5.4',
      '--cd', '/Users/test/Book',
      '--skip-git-repo-check',
      '--config', 'default_permissions="agent-server"',
      '--config', 'permissions.agent-server.network.enabled=true',
      '--config', 'approval_policy="never"',
      '--config', 'web_search="disabled"',
      '--config', 'openai_base_url="https://example.test/v1"',
    ]));
    expect(invocation.arguments).not.toContain('--sandbox');
    expect(invocation.arguments.join('\n')).toContain('permissions.agent-server.filesystem=');
    expect(invocation.arguments.join('\n')).toContain('mcp_servers=');
    expect(invocation.environment).toEqual(expect.objectContaining({
      HOME: '/Users/test',
      PATH: '/usr/bin',
      CODEX_API_KEY: 'provider-key',
    }));
  });

  it('streams SDK-compatible events from the direct process', async () => {
    const script = [
      'process.stdin.resume();',
      'process.stdin.on("end", () => {',
      '  console.log(JSON.stringify({type:"thread.started",thread_id:"scoped-thread"}));',
      '  console.log(JSON.stringify({type:"turn.started"}));',
      '});',
    ].join('');
    const events = [];

    for await (const event of streamScopedCodex({
      executable: process.execPath,
      arguments: ['-e', script],
      environment: { PATH: process.env.PATH ?? '' },
    }, 'Prompt')) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thread.started', thread_id: 'scoped-thread' },
      { type: 'turn.started' },
    ]);
  });

  it('includes process diagnostics when a scoped run exits unsuccessfully', async () => {
    const events = streamScopedCodex({
      executable: process.execPath,
      arguments: ['-e', 'console.error("profile failed"); process.exit(7)'],
      environment: { PATH: process.env.PATH ?? '' },
    }, 'Prompt');

    await expect(async () => {
      for await (const event of events) void event;
    }).rejects.toThrow(/code 7.*profile failed/s);
  });
});
