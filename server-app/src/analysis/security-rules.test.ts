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

  it('produces a stable SHA-256 content hash', () => {
    expect(computeAgentContentHash('same content')).toBe(computeAgentContentHash('same content'));
    expect(computeAgentContentHash('same content')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeAgentContentHash('same content')).not.toBe(computeAgentContentHash('changed content'));
  });
});
