import { describe, it, expect } from 'vitest';
import { matchesPattern, isToolAllowed, buildCanUseTool } from './permissions.js';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('matchesPattern', () => {
  it('matches exact tool names', () => {
    expect(matchesPattern('Read', 'Read')).toBe(true);
  });

  it('rejects non-matching exact names', () => {
    expect(matchesPattern('Read', 'Write')).toBe(false);
  });

  it('matches trailing wildcard', () => {
    expect(matchesPattern('mcp__claude_ai_Linear__list_issues', 'mcp__claude_ai_Linear__list_*')).toBe(true);
  });

  it('matches middle wildcard', () => {
    expect(matchesPattern('mcp__claude_ai_Notion__delete_page', 'mcp__*__delete_*')).toBe(true);
  });

  it('matches leading wildcard', () => {
    expect(matchesPattern('web_search', '*_search')).toBe(true);
  });

  it('matches single wildcard against any string', () => {
    expect(matchesPattern('anything_at_all', '*')).toBe(true);
  });

  it('is case sensitive', () => {
    expect(matchesPattern('read', 'Read')).toBe(false);
  });

  it('does not treat partial matches as full matches', () => {
    expect(matchesPattern('ReadFile', 'Read')).toBe(false);
  });

  it('escapes regex special characters in patterns', () => {
    expect(matchesPattern('tool.name', 'tool.name')).toBe(true);
    expect(matchesPattern('toolXname', 'tool.name')).toBe(false);
  });

  it('handles multiple wildcards', () => {
    expect(matchesPattern('mcp__claude_ai_Linear__list_issues', 'mcp__*__*')).toBe(true);
  });
});

describe('isToolAllowed', () => {
  it('allows a tool that matches an allow pattern', () => {
    expect(isToolAllowed('Read', { allow: ['Read', 'Write'], deny: [] })).toBe(true);
  });

  it('allows a tool matching a wildcard allow pattern', () => {
    expect(isToolAllowed(
      'mcp__claude_ai_Linear__list_projects',
      { allow: ['mcp__claude_ai_Linear__list_*'], deny: [] },
    )).toBe(true);
  });

  it('denies a tool not in either list', () => {
    expect(isToolAllowed('Bash', { allow: ['Read', 'Write'], deny: [] })).toBe(false);
  });

  it('denies a tool matching a deny pattern even if it matches allow', () => {
    expect(isToolAllowed('mcp__claude_ai_Linear__create_issue', {
      allow: ['mcp__claude_ai_Linear__*'],
      deny: ['mcp__*__create_*'],
    })).toBe(false);
  });

  it('denies everything when both lists are empty', () => {
    expect(isToolAllowed('Read', { allow: [], deny: [] })).toBe(false);
  });

  it('denies a tool matching an exact deny rule', () => {
    expect(isToolAllowed('Bash', { allow: ['*'], deny: ['Bash'] })).toBe(false);
  });
});

describe('buildCanUseTool', () => {
  it('returns allow for permitted tools', async () => {
    const canUseTool = buildCanUseTool({ allow: ['Read', 'Write'], deny: [] });
    const result = await canUseTool('Read', {}, makeToolOptions());
    expect(result.behavior).toBe('allow');
  });

  it('returns deny with message for unpermitted tools', async () => {
    const canUseTool = buildCanUseTool({ allow: ['Read'], deny: [] });
    const result = await canUseTool('Bash', {}, makeToolOptions());
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message).toContain('Bash');
    }
  });

  it('returns deny for tools matching deny patterns', async () => {
    const canUseTool = buildCanUseTool({
      allow: ['mcp__claude_ai_Linear__*'],
      deny: ['mcp__*__create_*'],
    });
    const result = await canUseTool('mcp__claude_ai_Linear__create_issue', {}, makeToolOptions());
    expect(result.behavior).toBe('deny');
  });

  it('enforces each reviewed file grant for read and write tools', async () => {
    const canUseTool = buildCanUseTool(
      { allow: ['Read', 'Write', 'Edit'], deny: [] },
      {
        cwd: '/Users/test',
        fileAccess: [
          { path: '/Users/test/Book/manuscript.docx', kind: 'file', access: 'read_only' },
          { path: '/Users/test/Book/Notes', kind: 'folder', access: 'read_write' },
        ],
      },
    );

    await expect(canUseTool('Read', { file_path: '/Users/test/Book/manuscript.docx' }, makeToolOptions()))
      .resolves.toEqual({ behavior: 'allow' });
    await expect(canUseTool('Write', { file_path: '/Users/test/Book/manuscript.docx' }, makeToolOptions()))
      .resolves.toMatchObject({ behavior: 'deny' });
    await expect(canUseTool('Edit', { file_path: '/Users/test/Book/Notes/review.md' }, makeToolOptions()))
      .resolves.toEqual({ behavior: 'allow' });
    await expect(canUseTool('Read', { file_path: '/Users/test/Book/private.md' }, makeToolOptions()))
      .resolves.toMatchObject({ behavior: 'deny' });
    await expect(canUseTool('Read', { file_path: '/Users/test/Book/Notes/../../private.md' }, makeToolOptions()))
      .resolves.toMatchObject({ behavior: 'deny' });
  });

  it('uses the narrowest overlapping grant and blocks symlink escapes and commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-file-grants-'));
    const allowed = join(root, 'allowed');
    const readonly = join(allowed, 'readonly');
    const outside = join(root, 'outside');
    mkdirSync(readonly, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(allowed, 'linked-outside'));
    const longAlias = join(root, 'a-very-long-alias-for-the-broad-writable-folder');
    symlinkSync(allowed, longAlias);
    const canUseTool = buildCanUseTool(
      { allow: ['Read', 'Write', 'Bash'], deny: [] },
      {
        cwd: root,
        fileAccess: [
          { path: longAlias, kind: 'folder', access: 'read_write' },
          { path: readonly, kind: 'folder', access: 'read_only' },
        ],
      },
    );
    try {
      await expect(canUseTool('Write', { file_path: join(readonly, 'note.md') }, makeToolOptions()))
        .resolves.toMatchObject({ behavior: 'deny' });
      await expect(canUseTool('Read', { file_path: join(allowed, 'linked-outside', 'secret.txt') }, makeToolOptions()))
        .resolves.toMatchObject({ behavior: 'deny' });
      await expect(canUseTool('Bash', { command: 'cat /etc/passwd' }, makeToolOptions()))
        .resolves.toMatchObject({ behavior: 'deny' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeToolOptions() {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-1',
  };
}
