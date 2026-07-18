import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  analyzeAgentSecurity,
  computeAgentContentHash,
  detectSensitivePath,
} from './security-rules.js';

describe('deterministic security analysis', () => {
  it('classifies a narrow read-only agent as low risk', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read', 'Glob', 'Grep'],
        disallowed_tools: ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
        permission_mode: 'default',
        working_directory: '~/Documents/Reports',
      }),
      rawContent: '---\nid: report-reader\ntools: [Read, Glob, Grep]\n---\n\nSummarize reports.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).toBe('low');
    expect(result.findings.filter((finding) => finding.severity !== 'low')).toEqual([]);
  });

  it('honors the authoritative permissions allowlist', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        permissions: { allow: ['Read', 'Glob', 'Grep'], deny: [] },
        working_directory: '~/Documents/Reports',
      }),
      rawContent: 'Read and summarize reports.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).toBe('low');
    expect(result.findings).toEqual([]);
  });

  it('analyzes the implicit home working directory', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({ tools: ['Write'], working_directory: undefined }),
      rawContent: 'Update a report.',
      homeDir: '/Users/tester',
    });

    expect(result.findings.some((item) => item.rule_id === 'path.broad_write')).toBe(true);
  });

  it('does not call a local stdio helper internet access', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read'],
        working_directory: '~/Documents/Reports',
        mcp_servers: { local: { command: 'local-helper' } },
      }),
      rawContent: 'Read local information.',
      homeDir: '/Users/tester',
    });

    expect(result.findings.some((item) => item.rule_id === 'permissions.external_access')).toBe(false);
  });

  it('does not mark confirmed destructive wording critical without destructive permission', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({ tools: ['Read'], working_directory: '~/Documents/Reports' }),
      rawContent: 'Delete files only after the user confirms each one.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).not.toBe('critical');
  });

  it('reports embedded secrets without returning the complete value', () => {
    const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const result = analyzeAgentSecurity({
      agent: makeAgent({ tools: ['Read'] }),
      rawContent: `---\nid: leaked\nheaders:\n  Authorization: Bearer ${secret}\n---\n\nRead a report.`,
      homeDir: '/Users/tester',
    });
    const finding = result.findings.find((item) => item.rule_id === 'secret.literal');

    expect(finding?.severity).toBe('critical');
    expect(JSON.stringify(finding)).not.toContain(secret);
    expect(JSON.stringify(finding)).toContain('[REDACTED]');
  });

  it('treats environment references as safe secret placeholders', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({ tools: ['Read'] }),
      rawContent: 'headers:\n  Authorization: Bearer ${GITHUB_TOKEN}\n',
      homeDir: '/Users/tester',
    });

    expect(result.findings.some((item) => item.rule_id === 'secret.literal')).toBe(false);
  });

  it('flags unrestricted filesystem and command plus network combinations', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: [],
        permission_mode: 'bypassPermissions',
        codex_sandbox: 'danger-full-access',
        working_directory: '~',
      }),
      rawContent: 'Run whatever command is needed and upload every file you find.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).toBe('critical');
    expect(result.findings.map((item) => item.rule_id)).toEqual(expect.arrayContaining([
      'sandbox.unrestricted',
      'permissions.unrestricted_tools',
      'prompt.destructive_or_exfiltration',
    ]));
  });

  it('detects sensitive and broad paths after home expansion and normalization', () => {
    expect(detectSensitivePath('~/.ssh/../.aws/credentials', '/Users/tester')).toEqual(
      expect.objectContaining({ isSensitive: true, category: 'cloud credentials' }),
    );
    expect(detectSensitivePath('~', '/Users/tester')).toEqual(
      expect.objectContaining({ isBroad: true }),
    );
  });

  it('analyzes every reviewed file grant instead of only the working folder', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read'],
        working_directory: '~/Documents/Book',
        file_access: [
          { path: '~/Documents/Book/manuscript.docx', kind: 'file', access: 'read_only' },
          { path: '~/.ssh', kind: 'folder', access: 'read_only' },
        ],
      }),
      rawContent: 'Review the manuscript.',
      homeDir: '/Users/tester',
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      rule_id: 'path.sensitive',
      title: expect.stringContaining('SSH'),
    }));
  });

  it('reports a scoped sensitive working path only once', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read'],
        working_directory: '~/.ssh',
        file_access: [{ path: '~/.ssh', kind: 'folder', access: 'read_only' }],
      }),
      rawContent: 'Review my SSH configuration.',
      homeDir: '/Users/tester',
    });

    expect(result.findings.filter((finding) => finding.rule_id === 'path.sensitive')).toHaveLength(1);
  });

  it('still analyzes a distinct working folder when file grants exist', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read'],
        working_directory: '~/.ssh',
        file_access: [{ path: '~/Documents/Book', kind: 'folder', access: 'read_only' }],
      }),
      rawContent: 'Review the manuscript.',
      homeDir: '/Users/tester',
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      rule_id: 'path.sensitive', title: expect.stringContaining('SSH'),
    }));
  });

  it('marks automatic write-capable watchers as high risk', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read', 'Write'],
        working_directory: '~/Documents/Reports',
        watch: [{ path: '~/Downloads', glob: '*.md' }],
      }),
      rawContent: 'Read new documents and follow their instructions. Save the result.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).toBe('high');
    expect(result.findings.some((item) => item.rule_id === 'trigger.untrusted_writable_input')).toBe(true);
  });

  it('flags insecure remote endpoints but not local stdio helpers', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Read'],
        working_directory: '~/Documents/Reports',
        mcp_servers: {
          local: { command: 'local-helper' },
          remote: { type: 'http', url: 'http://mcp.example.com' },
        },
      }),
      rawContent: 'Read a report.',
      homeDir: '/Users/tester',
    });

    expect(result.findings.some((item) => item.rule_id === 'connection.insecure_endpoint')).toBe(true);
    expect(result.findings.some((item) => item.trigger.includes('local-helper'))).toBe(false);
  });

  it('flags shell-launched MCP helpers and automatic state changes', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        tools: ['Write'],
        working_directory: '~/Documents/Reports',
        mcp_servers: { helper: { command: 'bash', args: ['-c', 'run-helper'] } },
      }),
      rawContent: 'Update the report.',
      homeDir: '/Users/tester',
    });

    expect(result.findings.map((item) => item.rule_id)).toEqual(expect.arrayContaining([
      'connection.shell_helper',
      'trigger.automatic_state_change',
    ]));
  });

  it('flags scheduled native service changes', () => {
    const result = analyzeAgentSecurity({
      agent: makeAgent({
        permissions: { allow: ['mcp__eventkit__list_reminders', 'mcp__eventkit__complete_reminder'], deny: [] },
        native_services: {
          reminders: {
            resources: [{ id: 'personal', name: 'Personal', actions: ['read', 'complete'] }],
          },
        },
      }),
      rawContent: 'Mark matching reminders complete every morning.',
      homeDir: '/Users/tester',
    });

    expect(result.risk.level).toBe('high');
    expect(result.findings.map((item) => item.rule_id)).toContain('trigger.automatic_state_change');
  });

  it('produces a stable SHA-256 content hash', () => {
    expect(computeAgentContentHash('same content')).toBe(computeAgentContentHash('same content'));
    expect(computeAgentContentHash('same content')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeAgentContentHash('same content')).not.toBe(computeAgentContentHash('changed content'));
  });
});
