import { describe, it, expect } from 'vitest';
import { readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createTempDir, makeAgent } from '../test-factories.js';
import { parseAgentFile } from './config.js';
import type { AvailableConnection } from './capabilities.js';
import { AgentWriteError, createAgentWriter, type AgentWriter } from './writer.js';

const YAML_AGENT = `# Morning briefing agent
id: briefing
name: Morning Briefing
description: Summarizes the day ahead
schedule: "0 8 * * *"   # every morning at 8
prompt: |
  Summarize my calendar and todos for today.
tools:
  - Read
  - Glob
max_turns: 12
enabled: true
`;

const MD_AGENT = `---
id: reporter
name: Weekly Reporter
# posts to the team channel
schedule: "0 9 * * 1"
tools:
  - Read
  - Write
---

# Weekly report

Write the weekly status report.
`;

async function seededWriter(files: Record<string, string>, env: Record<string, string | undefined> = {}): Promise<{ dir: string; writer: AgentWriter }> {
  const dir = createTempDir('writer');
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf-8');
  }
  return { dir, writer: createAgentWriter(dir, { env: () => env }) };
}

describe('AgentWriter.update', () => {
  it('rejects switching an agent with unbound credential MCP configuration to Codex', async () => {
    const credentialAgent = `---
id: reporter
name: Weekly Reporter
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: \${NOTION_PERSONAL_API_KEY}
---

# Weekly report
`;
    const { writer } = await seededWriter(
      { 'reporter.md': credentialAgent },
      { NOTION_PERSONAL_API_KEY: 'configured' },
    );

    await expect(writer.update('reporter', { executor: 'codex' })).rejects.toThrow(
      'Codex requires saved connections for MCP servers with credentials',
    );
  });

  it('rejects switching an agent that depends on Claude account tools to Codex', async () => {
    const claudeAccountAgent = `---
id: reporter
name: Weekly Reporter
tools:
  - mcp__claude_ai_Notion
---

# Weekly report
`;
    const { writer } = await seededWriter({ 'reporter.md': claudeAccountAgent });

    await expect(writer.update('reporter', { executor: 'codex' })).rejects.toThrow(
      'This agent uses Claude account connections that Codex cannot access',
    );
  });

  it('allows switching an agent with a saved credential connection to Codex', async () => {
    const connectionId = '11111111-1111-4111-8111-111111111111';
    const savedConnectionAgent = `---
id: reporter
name: Weekly Reporter
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: \${NOTION_PERSONAL_API_KEY}
connection_bindings:
  notion-personal: ${connectionId}
---

# Weekly report
`;
    const { writer } = await seededWriter(
      { 'reporter.md': savedConnectionAgent },
      { NOTION_PERSONAL_API_KEY: 'configured' },
    );

    const updated = await writer.update('reporter', { executor: 'codex' });

    expect(updated.executor).toBe('codex');
    expect(updated.connection_bindings).toEqual({ 'notion-personal': connectionId });
  });

  it('serializes writes to the same Markdown agent so concurrent patches cannot revert each other', async () => {
    const dir = createTempDir('writer-concurrent-update');
    await writeFile(join(dir, 'reporter.md'), MD_AGENT, 'utf-8');
    let releaseFirstLookup: (() => void) | undefined;
    let markFirstLookupStarted: (() => void) | undefined;
    let lookupCount = 0;
    const firstLookup = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const firstLookupStarted = new Promise<void>((resolve) => {
      markFirstLookupStarted = resolve;
    });
    const writer = createAgentWriter(dir, {
      availableConnections: async () => {
        lookupCount += 1;
        if (lookupCount === 1) {
          markFirstLookupStarted?.();
          await firstLookup;
        }
        return [];
      },
    });

    const rename = writer.update('reporter', { name: 'Durable Reporter' });
    await firstLookupStarted;
    const describe = writer.update('reporter', { description: 'Keeps every saved field' });
    await Promise.race([
      describe,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    releaseFirstLookup?.();
    await Promise.all([rename, describe]);

    const saved = parseAgentFile(await readFile(join(dir, 'reporter.md'), 'utf-8'));
    expect(saved.name).toBe('Durable Reporter');
    expect(saved.description).toBe('Keeps every saved field');
  });

  it('updates a field in a pure YAML agent and preserves comments', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    const updated = await writer.update('briefing', { name: 'Daily Briefing' });
    expect(updated.name).toBe('Daily Briefing');

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).toContain('# Morning briefing agent');
    expect(content).toContain('# every morning at 8');
    expect(content).toContain('Daily Briefing');
    expect(content).toContain('Summarize my calendar');
  });

  it('updates frontmatter fields without touching the markdown body', async () => {
    const { dir, writer } = await seededWriter({ 'reporter.md': MD_AGENT });

    await writer.update('reporter', { description: 'Posts weekly status' });

    const content = await readFile(join(dir, 'reporter.md'), 'utf-8');
    expect(content).toContain('# posts to the team channel');
    expect(content).toContain('description: Posts weekly status');
    expect(content).toContain('# Weekly report\n\nWrite the weekly status report.');
    expect(parseAgentFile(content).description).toBe('Posts weekly status');
  });

  it('updates an opaque saved connection binding without rewriting its inline fallback', async () => {
    const original = `---
id: reporter
name: Weekly Reporter
# Keep the inline fallback readable
mcp_servers:
  notes:
    command: old-notes-helper
custom_setting: keep-me
---

# Weekly report
`;
    const { dir, writer } = await seededWriter({ 'reporter.md': original });
    const connectionId = '11111111-1111-4111-8111-111111111111';

    const updated = await writer.update('reporter', {
      connection_bindings: { notes: connectionId },
    });

    expect(updated.connection_bindings).toEqual({ notes: connectionId });
    const content = await readFile(join(dir, 'reporter.md'), 'utf-8');
    expect(content).toContain('# Keep the inline fallback readable');
    expect(content).toContain('command: old-notes-helper');
    expect(content).toContain('custom_setting: keep-me');
    expect(content).toContain(`notes: ${connectionId}`);
  });

  it('attaches a reusable API connection selected in agent settings', async () => {
    const dir = createTempDir('writer-connection');
    await writeFile(join(dir, 'briefing.yaml'), YAML_AGENT, 'utf-8');
    const connection: AvailableConnection = {
      id: 'mcp:notion-personal:one',
      serviceId: 'notion',
      name: 'Personal Notion',
      source: 'configured_api',
      status: 'connected',
      requiredEnv: ['NOTION_PERSONAL_API_KEY'],
      serverName: 'notion-personal',
      config: {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      },
    };
    const writer = createAgentWriter(dir, {
      env: () => ({ NOTION_PERSONAL_API_KEY: 'configured' }),
      availableConnections: async () => [connection],
    });

    const updated = await writer.update('briefing', {
      capabilities: [{ id: `connection:${connection.id}`, enabled: true }],
    });

    expect(updated.mcp_servers?.['notion-personal']).toEqual(connection.config);
    expect(updated.tools).toContain('mcp__notion-personal');
  });

  it('resolves account MCP choices against the LLM saved in the current Markdown agent', async () => {
    const dir = createTempDir('writer-account-connection');
    await writeFile(join(dir, 'briefing.yaml'), YAML_AGENT, 'utf-8');
    const accountConnection: AvailableConnection = {
      id: 'runtime:claude.ai%20Notion',
      serviceId: 'notion',
      name: 'Notion (Claude account)',
      source: 'account',
      status: 'connected',
      requiredEnv: [],
      serverName: 'claude.ai Notion',
    };
    const writer = createAgentWriter(dir, {
      availableConnections: async (agent) => agent.executor === undefined
        ? [accountConnection]
        : [],
    });

    const updated = await writer.update('briefing', {
      capabilities: [{ id: `connection:${accountConnection.id}`, enabled: true }],
    });

    expect(updated.tools).toContain('mcp__claude_ai_Notion');
  });

  it('replaces the markdown body when patching the prompt', async () => {
    const { dir, writer } = await seededWriter({ 'reporter.md': MD_AGENT });

    const updated = await writer.update('reporter', { prompt: 'New instructions here.' });
    expect(updated.prompt).toBe('New instructions here.');

    const content = await readFile(join(dir, 'reporter.md'), 'utf-8');
    expect(content).toContain('New instructions here.');
    expect(content).not.toContain('Write the weekly status report');
    expect(content).toContain('schedule: "0 9 * * 1"');
  });

  it('writes multi-line prompts as block literals in pure YAML', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    await writer.update('briefing', { prompt: 'Line one.\nLine two.' });

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).toMatch(/prompt: \|/);
    expect(parseAgentFile(content).prompt).toBe('Line one.\nLine two.');
  });

  it('removes a field when patched with null', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    const updated = await writer.update('briefing', { schedule: null, description: null });
    expect(updated.schedule).toBeUndefined();
    expect(updated.description).toBeUndefined();

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).not.toContain('schedule:');
    expect(content).not.toContain('description:');
  });

  it('sets the executor, model, and custom provider block (Model dropdown)', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    const updated = await writer.update('briefing', {
      executor: 'codex',
      model: 'kimi-k3',
      provider: { base_url: 'https://api.moonshot.ai/v1', api_key: '${MOONSHOT_API_KEY}' },
    });

    expect(updated.executor).toBe('codex');
    expect(updated.model).toBe('kimi-k3');
    expect(updated.provider).toEqual({ base_url: 'https://api.moonshot.ai/v1', api_key: '${MOONSHOT_API_KEY}' });

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    // Round-trip parses back to the same values (the ${VAR} ref stays literal).
    const reparsed = parseAgentFile(content);
    expect(reparsed.provider?.base_url).toBe('https://api.moonshot.ai/v1');
    expect(reparsed.provider?.api_key).toBe('${MOONSHOT_API_KEY}');
    expect(content).toContain('# Morning briefing agent'); // comment preserved
  });

  it('selects Kimi Code without changing unrelated agent fields', async () => {
    const { dir, writer } = await seededWriter({
      'writer.md': `---\nid: writer\nname: Writer\ncustom_setting: keep-me\n---\n\nWrite clearly.\n`,
    });

    const updated = await writer.update('writer', { executor: 'kimi-code' });

    expect(updated.executor).toBe('kimi-code');
    expect(await readFile(join(dir, 'writer.md'), 'utf8')).toContain('custom_setting: keep-me');
  });

  it('clears the provider and model when switching back to the default plan', async () => {
    const { dir, writer } = await seededWriter({
      'kimi.yaml': `id: kimi
name: Kimi Agent
prompt: Do the thing.
executor: codex
model: kimi-k3
provider:
  base_url: https://api.moonshot.ai/v1
  api_key: \${MOONSHOT_API_KEY}
tools:
  - Read
max_turns: 5
enabled: true
`,
    });

    const updated = await writer.update('kimi', { executor: null, model: null, provider: null });
    expect(updated.executor).toBeUndefined();
    expect(updated.model).toBeUndefined();
    expect(updated.provider).toBeUndefined();

    const content = await readFile(join(dir, 'kimi.yaml'), 'utf-8');
    expect(content).not.toContain('provider:');
    expect(content).not.toContain('model:');
    expect(content).not.toContain('base_url');
  });

  it('applies capability toggles on top of the existing config', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    const updated = await writer.update('briefing', {
      capabilities: [
        { id: 'write-files', enabled: true },
        { id: 'run-commands', enabled: false },
      ],
    });
    expect(updated.tools).toEqual(['Read', 'Glob', 'Write', 'Edit']);
    expect(updated.disallowed_tools).toEqual(['Bash']);

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).toContain('# Morning briefing agent');
  });

  it('persists removal of file editing for an agent with detailed permissions', async () => {
    const original = `---
id: editor
name: Manuscript Editor
description: >
  Keep this exact wrapping because a small permission edit must not reflow
  unrelated frontmatter text.
tools: ["Read", "Write", "Edit"]
permissions:
  allow:
    - "Read"
    - "Write"
    - "Edit"
    - "mcp__notion-personal__notion-search"
  deny:
    - "Bash"
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
custom_field: keep-me
---
# Edit the manuscript
`;
    const { dir, writer } = await seededWriter({ 'editor.md': original });

    const updated = await writer.update('editor', {
      capabilities: [{ id: 'write-files', enabled: false }],
    });

    expect(updated.permissions).toEqual({
      allow: ['Read', 'mcp__notion-personal__notion-search'],
      deny: ['Bash', 'Write', 'Edit'],
    });
    const content = await readFile(join(dir, 'editor.md'), 'utf-8');
    expect(content).toBe(original
      .replace('    - "Write"\n    - "Edit"\n', '')
      .replace('    - "Bash"\n', '    - "Bash"\n    - "Write"\n    - "Edit"\n'));
  });

  it('preserves every unrelated byte when changing a top-level field', async () => {
    const original = `---
id: editor
name: Manuscript Editor
description: >
  Keep this unusual
  wrapping.
schedule: "0 3 * * *" # keep this comment
---
# Body starts immediately after the delimiter.
`;
    const { dir, writer } = await seededWriter({ 'editor.md': original });

    await writer.update('editor', { name: 'Book Editor' });

    const content = await readFile(join(dir, 'editor.md'), 'utf-8');
    expect(content).toBe(original.replace('name: Manuscript Editor', 'name: Book Editor'));
  });

  it('writes mcp server entries when enabling a connected capability', async () => {
    const { dir, writer } = await seededWriter(
      { 'briefing.yaml': YAML_AGENT },
      { NOTION_API_KEY: 'secret' },
    );

    const updated = await writer.update('briefing', {
      capabilities: [{ id: 'notion', enabled: true }],
    });
    expect(updated.mcp_servers?.notion).toBeDefined();
    expect(updated.tools).toContain('mcp__notion');

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).toContain('${NOTION_API_KEY}');
    expect(content).not.toContain('secret');
  });

  it('propagates missing_env as an AgentWriteError', async () => {
    const { writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT }, {});

    let caught: unknown;
    try {
      await writer.update('briefing', { capabilities: [{ id: 'notion', enabled: true }] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentWriteError);
    expect((caught as AgentWriteError).code).toBe('missing_env');
    expect((caught as AgentWriteError).missingEnv).toEqual(['NOTION_API_KEY']);
  });

  it('rejects invalid cron schedules', async () => {
    const { writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });
    await expect(writer.update('briefing', { schedule: 'not a cron' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('throws not_found for unknown agents', async () => {
    const { writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });
    await expect(writer.update('ghost', { name: 'X' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('round-trips unknown passthrough fields untouched', async () => {
    const withExtras = `${YAML_AGENT}telemetry:\n  progress_mode: batched\ncustom_field: keep-me\n`;
    const { dir, writer } = await seededWriter({ 'briefing.yaml': withExtras });

    await writer.update('briefing', { name: 'Renamed' });

    const content = await readFile(join(dir, 'briefing.yaml'), 'utf-8');
    expect(content).toContain('progress_mode: batched');
    expect(content).toContain('custom_field: keep-me');
  });
});

describe('AgentWriter.create', () => {
  it('creates a reviewed agent with an explicit default-deny policy', async () => {
    const { dir, writer } = await seededWriter({});

    const created = await writer.createReviewed(makeAgent({
      id: 'reviewed-reader',
      name: 'Reviewed Reader',
      prompt: '# Reviewed reader\n\nRead the selected notes and summarize them.',
      schedule: undefined,
      tools: ['Read', 'Glob', 'Grep'],
      permissions: { allow: ['Read', 'Glob', 'Grep'], deny: [] },
      codex_sandbox: 'read-only',
      enabled: false,
    }));

    expect(created.agent.permissions).toEqual({ allow: ['Read', 'Glob', 'Grep'], deny: [] });
    expect(created.agent.enabled).toBe(false);
    const content = await readFile(join(dir, 'reviewed-reader.md'), 'utf-8');
    expect(content).toContain('permissions:');
    expect(content).toContain('codex_sandbox: read-only');
    expect(content).toContain('# Reviewed reader');
    expect(parseAgentFile(content).id).toBe('reviewed-reader');
  });

  it('refuses to save a reviewed agent without explicit permissions', async () => {
    const { writer } = await seededWriter({});

    await expect(writer.createReviewed(makeAgent({
      id: 'unreviewed',
      permissions: undefined,
    }))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('creates a markdown agent with a slugified id', async () => {
    const { dir, writer } = await seededWriter({});

    const created = await writer.create({
      name: 'My Trip Planner!',
      prompt: 'Plan my trips.',
      schedule: '0 7 * * *',
    });
    expect(created.id).toBe('my-trip-planner');
    expect(created.schedule).toBe('0 7 * * *');

    const content = await readFile(join(dir, 'my-trip-planner.md'), 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('Plan my trips.');
    expect(parseAgentFile(content).id).toBe('my-trip-planner');
  });

  it('creates a shareable agent with portable connection and output contracts', async () => {
    const { dir, writer } = await seededWriter({});

    await writer.create({
      name: 'Daily Focus',
      prompt: 'Create the daily focus page.',
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Publish the daily focus page',
          operations: ['notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source',
              purpose: 'Daily focus destination',
              access: 'write',
            },
          },
        },
      },
      output: {
        primary: {
          description: 'One daily focus page',
          use: 'work_notes',
          operation: 'notion.page.create',
          target: 'report_database',
        },
      },
    });

    const content = await readFile(join(dir, 'daily-focus.md'), 'utf-8');
    expect(content).toContain('name: Notion Work');
    expect(content).toContain('operation: notion.page.create');
    expect(content).not.toContain('executor:');
    expect(content).not.toContain('mcp__');
  });

  it('creates a shareable agent with a semantic skill requirement', async () => {
    const { dir, writer } = await seededWriter({});

    await writer.create({
      name: 'Manuscript Review',
      prompt: 'Review the manuscript.',
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic',
          purpose: 'Find structural, continuity, character, and prose problems.',
        },
      },
    });

    const content = await readFile(join(dir, 'manuscript-review.md'), 'utf8');
    expect(content).toContain('name: Fiction manuscript diagnostic');
    expect(content).not.toContain('fiction-diagnostic');
    expect(parseAgentFile(content).skills).toBeDefined();
  });

  it('builds an explicit allowlist from enabled capabilities', async () => {
    const { writer } = await seededWriter({}, { NOTION_API_KEY: 'secret' });

    const created = await writer.create({
      name: 'Notion Notetaker',
      prompt: 'Take notes.',
      capabilities: [
        { id: 'read-files', enabled: true },
        { id: 'write-files', enabled: false },
        { id: 'notion', enabled: true },
      ],
    });
    expect(created.tools).toEqual(['Read', 'Glob', 'Grep', 'mcp__notion']);
    expect(created.mcp_servers?.notion).toBeDefined();
    // write-files stays off because it is simply absent from the allowlist.
    expect(created.disallowed_tools).toEqual([]);
  });

  it('falls back to denials when every capability is toggled off', async () => {
    const { writer } = await seededWriter({});

    const created = await writer.create({
      name: 'Locked Down',
      prompt: 'Do nothing risky.',
      capabilities: [
        { id: 'run-commands', enabled: false },
        { id: 'browse-web', enabled: false },
      ],
    });
    expect(created.tools).toEqual([]);
    expect(created.disallowed_tools).toEqual(['Bash', 'WebFetch', 'WebSearch']);
  });

  it('rejects duplicate agent ids', async () => {
    const { writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });
    await expect(
      writer.create({ id: 'briefing', name: 'Clone', prompt: 'Copy.' }),
    ).rejects.toMatchObject({ code: 'already_exists' });
  });

  it('rejects names that cannot become a valid id', async () => {
    const { writer } = await seededWriter({});
    await expect(writer.create({ name: '???', prompt: 'Hm.' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('AgentWriter.remove', () => {
  it('moves the file into .deleted instead of destroying it', async () => {
    const { dir, writer } = await seededWriter({ 'briefing.yaml': YAML_AGENT });

    await writer.remove('briefing');

    const topLevel = await readdir(dir);
    expect(topLevel.filter((f) => f.endsWith('.yaml'))).toEqual([]);
    const trashed = await readdir(join(dir, '.deleted'));
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain('briefing.yaml');
  });

  it('throws not_found for unknown agents', async () => {
    const { writer } = await seededWriter({});
    await expect(writer.remove('ghost')).rejects.toMatchObject({ code: 'not_found' });
  });
});
