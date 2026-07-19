import { describe, expect, it } from 'vitest';
import {
  ConfigurationPatchSchema,
  InMemoryAgentContentRepository,
  isUnsafeAutomatedFilePath,
  PatchConflictError,
  PatchPolicyError,
  StructuredPatchService,
} from './patch.js';
import { parseAgentFile } from '../agents/config.js';
import { computeAgentContentHash } from './security-rules.js';

const original = `---
# Keep this explanation
id: reports
name: Reports
custom_setting: keep-me
schedule: "0 17 * * 5"
tools:
  - Read
---

# Review reports

Summarize the selected files.
`;

function safePatch(content = original) {
  return ConfigurationPatchSchema.parse({
    schema_version: 1,
    agent_id: 'reports',
    expected_content_hash: computeAgentContentHash(content),
    source: 'debugger',
    reason: 'Use the folder selected by the user',
    changes: {
      working_directory: '/Users/example/Documents/Reports',
      prompt: '# Review reports\n\nSummarize the selected files. Do not modify them.',
    },
  });
}

describe('structured configuration patches', () => {
  it('preserves unrelated frontmatter and body bytes in a reviewed patch', async () => {
    const formatted = `---
# Keep this explanation
id: reports
name: Reports
description: >
  Preserve this deliberate
  wrapping exactly.
schedule: "0 17 * * 5"
tools: ["Read"]
enabled: true
---
# Body begins without an extra blank line.
`;
    const repository = new InMemoryAgentContentRepository({ reports: formatted });
    const patch = ConfigurationPatchSchema.parse({
      schema_version: 1,
      agent_id: 'reports',
      expected_content_hash: computeAgentContentHash(formatted),
      source: 'debugger',
      reason: 'Turn off the schedule while it is reviewed',
      changes: { enabled: false },
    });

    const preview = await new StructuredPatchService(repository).preview(patch);

    expect(preview.result_content).toBe(formatted.replace('enabled: true', 'enabled: false'));
  });

  it('recognizes relocated macOS home folders as broad access', () => {
    expect(isUnsafeAutomatedFilePath('/Volumes/Homes/example', '/Volumes/Homes/example')).toBe(true);
    expect(isUnsafeAutomatedFilePath('/Volumes/Homes/example/Documents', '/Volumes/Homes/example')).toBe(false);
  });

  it('previews consumer changes while preserving comments and unknown fields', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const preview = await new StructuredPatchService(repository).preview(safePatch());

    expect(preview.changes).toEqual(expect.arrayContaining([
      { field: 'working_directory', summary: 'Change the working folder' },
      { field: 'prompt', summary: 'Update the agent instructions' },
    ]));
    expect(preview.result_content).toContain('# Keep this explanation');
    expect(preview.result_content).toContain('custom_setting: keep-me');
    expect(preview.result_content).toContain('Do not modify them.');
    expect(preview.result_content).not.toContain('expected_content_hash');
  });

  it('applies atomically and supports one safe rollback', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const applied = await service.apply(safePatch());

    expect(computeAgentContentHash(await repository.read('reports'))).toBe(applied.result_content_hash);
    await service.rollback(applied.rollback_token);
    expect(await repository.read('reports')).toBe(original);
    await expect(service.rollback(applied.rollback_token)).rejects.toThrow('Rollback token is not available');
  });

  it('rejects stale previews without changing the agent', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = safePatch();
    await repository.writeAtomic('reports', original.replace('Reports\n', 'Weekly reports\n'));

    await expect(service.apply(patch)).rejects.toBeInstanceOf(PatchConflictError);
    expect(await repository.read('reports')).toContain('Weekly reports');
  });

  it.each([
    { permission_mode: 'bypassPermissions' },
    { codex_sandbox: 'danger-full-access' },
    { working_directory: '~' },
    { working_directory: '/Users/example' },
    { tools: ['Read', 'Bash'] },
    { tools: [] },
    { permissions: { allow: ['Bash'], deny: [] } },
    { mcp_servers: { helper: { command: 'bash', args: ['-c', 'node helper.js'] } } },
  ])('rejects high-risk permission grants: $permission_mode$codex_sandbox$working_directory', async (changes) => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes,
    });

    await expect(service.preview(patch)).rejects.toBeInstanceOf(PatchPolicyError);
    expect(await repository.read('reports')).toBe(original);
  });

  it.each([
    { tools: ['Read', 'Write'] },
    { network_access: true },
    { codex_sandbox: 'workspace-write' },
    { notification: { channel: 'telegram', on_complete: true, on_failure: true } },
    { mcp_servers: { service: { type: 'http', url: 'https://service.example/mcp' } } },
  ])('previews a high-risk change but requires matching confirmation before apply', async (changes) => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const unconfirmed = ConfigurationPatchSchema.parse({ ...safePatch(), changes });
    const preview = await service.preview(unconfirmed);

    expect(preview.risk).toBe('high');
    expect(preview.requires_confirmation).toBe(true);
    await expect(service.apply(unconfirmed)).rejects.toBeInstanceOf(PatchPolicyError);

    const confirmed = ConfigurationPatchSchema.parse({
      ...unconfirmed,
      confirmation: { approved: true, preview_content_hash: preview.result_content_hash },
    });
    await expect(service.apply(confirmed)).resolves.toMatchObject({ result_content_hash: preview.result_content_hash });
  });

  it('forbids destructive instruction changes even when confirmation is present', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: { prompt: 'Delete every file in the selected folder.' },
      confirmation: { approved: true, preview_content_hash: computeAgentContentHash('placeholder') },
    });
    await expect(service.preview(patch)).rejects.toBeInstanceOf(PatchPolicyError);
  });

  it('previews a literal credential safely but never applies it', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(), changes: { prompt: 'Use token sk-live-abcdefghijklmnop to read reports.' },
    });
    const preview = await service.preview(patch);
    expect(preview.can_apply).toBe(false);
    expect(preview.risk_reasons).toContain('Contains a literal credential');
    await expect(service.apply(patch)).rejects.toBeInstanceOf(PatchPolicyError);
  });

  it('never applies a literal credential inside a connected service', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: { mcp_servers: {
        service: {
          type: 'http',
          url: 'https://service.example/mcp',
          headers: { Authorization: 'Bearer literal-secret-value-12345' },
        },
      } },
    });
    const preview = await service.preview(patch);
    expect(preview.can_apply).toBe(false);
    await expect(service.apply({
      ...patch,
      confirmation: { approved: true, preview_content_hash: preview.result_content_hash },
    })).rejects.toBeInstanceOf(PatchPolicyError);
  });

  it('rejects malformed schedules before producing a preview', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({ ...safePatch(), changes: { schedule: 'Friday afternoon' } });

    await expect(service.preview(patch)).rejects.toThrow('valid schedule');
  });

  it('requires confirmation before removing an existing allowlist', async () => {
    const restricted = original.replace('tools:\n  - Read', 'permissions:\n  allow: [Read]\n  deny: [Bash]');
    const repository = new InMemoryAgentContentRepository({ reports: restricted });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({ ...safePatch(restricted), changes: { permissions: null } });

    const preview = await service.preview(patch);
    expect(preview.risk_reasons).toContain('Removes an existing action allowlist');
    await expect(service.apply(patch)).rejects.toBeInstanceOf(PatchPolicyError);
  });

  it('turns off network tools in both supported permission formats', async () => {
    const restricted = original.replace('tools:\n  - Read', 'permissions:\n  allow: [Read, WebFetch]\n  deny: []');
    const repository = new InMemoryAgentContentRepository({ reports: restricted });
    const service = new StructuredPatchService(repository);
    const preview = await service.preview(ConfigurationPatchSchema.parse({
      ...safePatch(restricted), changes: { network_access: false },
    }));

    expect(preview.result_content).toContain('deny:');
    expect(preview.result_content).toContain('WebFetch');
    expect(preview.result_content).not.toContain('network_access');
    expect(parseAgentFile(preview.result_content).permissions?.deny).toEqual(
      expect.arrayContaining(['WebFetch', 'WebSearch', 'web_search']),
    );
  });

  it('turns on network tools only after the reviewed high-risk preview is confirmed', async () => {
    const restricted = original.replace(
      'tools:\n  - Read',
      'permissions:\n  allow: [Read]\n  deny: [WebFetch, WebSearch, web_search]',
    );
    const repository = new InMemoryAgentContentRepository({ reports: restricted });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(restricted), changes: { network_access: true },
    });
    const preview = await service.preview(patch);

    expect(preview.requires_confirmation).toBe(true);
    const parsedPreview = parseAgentFile(preview.result_content);
    expect(parsedPreview.permissions?.allow).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
    expect(parsedPreview.permissions?.deny).not.toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
    expect(preview.result_content).not.toContain('network_access');

    await service.apply(ConfigurationPatchSchema.parse({
      ...patch,
      confirmation: { approved: true, preview_content_hash: preview.result_content_hash },
    }));
    expect(parseAgentFile(await repository.read('reports')).permissions?.allow).toContain('WebFetch');
  });

  it('accepts the remaining supported agent configuration fields', () => {
    expect(ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: {
        max_turns: 12,
        timeout: '10m',
        conversation: { enabled: true, ttl: '30m' },
        telemetry: { progress_mode: 'batched' },
      },
    }).changes).toMatchObject({ max_turns: 12, timeout: '10m' });
  });

  it('previews exact native service grants and preserves them after apply', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const patch = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: {
        native_services: {
          contacts: {
            resources: [{
              id: 'family', name: 'Family', account: 'iCloud', actions: ['read'], fields: ['name', 'email'],
            }],
          },
        },
      },
    });

    const preview = await service.preview(patch);
    expect(preview.changes).toContainEqual({
      field: 'native_services', summary: 'Change access to Mac apps',
    });
    expect(preview.risk_reasons).toContain('Changes access to personal information');

    await service.apply(ConfigurationPatchSchema.parse({
      ...patch,
      confirmation: { approved: true, preview_content_hash: preview.result_content_hash },
    }));
    expect(parseAgentFile(await repository.read('reports')).native_services).toEqual(
      patch.changes.native_services,
    );
  });

  it('rejects broad file grants and reviews narrow writable grants as high risk', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    const broad = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: { file_access: [{ path: '/Users/example', kind: 'folder', access: 'read_only' }] },
    });
    await expect(service.preview(broad)).rejects.toBeInstanceOf(PatchPolicyError);
    const traversal = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: { file_access: [{ path: '/Users/example/Documents/..', kind: 'folder', access: 'read_only' }] },
    });
    await expect(service.preview(traversal)).rejects.toBeInstanceOf(PatchPolicyError);

    const narrow = ConfigurationPatchSchema.parse({
      ...safePatch(),
      changes: {
        file_access: [{ path: '/Users/example/Documents/Reports', kind: 'folder', access: 'read_write' }],
      },
    });
    await expect(service.preview(narrow)).resolves.toMatchObject({
      risk: 'high', risk_reasons: ['Changes file or folder access'],
    });
  });

  it('keeps only the fifty newest rollback backups', async () => {
    const repository = new InMemoryAgentContentRepository({ reports: original });
    const service = new StructuredPatchService(repository);
    let firstToken = '';
    for (let index = 0; index < 51; index += 1) {
      const current = await repository.read('reports');
      const result = await service.apply(ConfigurationPatchSchema.parse({
        ...safePatch(current), changes: { description: `Revision ${index}` },
      }));
      if (index === 0) firstToken = result.rollback_token;
    }
    await expect(service.rollback(firstToken)).rejects.toThrow('not available');
  });
});
