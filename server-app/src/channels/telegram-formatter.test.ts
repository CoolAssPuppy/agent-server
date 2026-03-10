import { describe, it, expect } from 'vitest';
import { formatTelegramNotification } from './telegram-formatter.js';
import type { NotificationData } from '../interaction/notification.js';

function makeNotification(overrides: Partial<NotificationData> = {}): NotificationData {
  return {
    agentName: 'Daily Report',
    status: 'completed',
    ...overrides,
  };
}

describe('formatTelegramNotification', () => {
  describe('completed notifications', () => {
    it('includes a checkmark and the agent name in bold', () => {
      const result = formatTelegramNotification(makeNotification());
      expect(result).toContain('\u2705');
      expect(result).toContain('<b>Daily Report</b>');
      expect(result).toContain('completed');
    });

    it('includes the summary text', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: 'Created 3 reports in Notion',
      }));
      expect(result).toContain('Created 3 reports in Notion');
    });

    it('shows turn count when provided', () => {
      const result = formatTelegramNotification(makeNotification({ turnCount: 12 }));
      expect(result).toContain('12 turns');
    });

    it('shows duration when provided', () => {
      const result = formatTelegramNotification(makeNotification({ durationMs: 95000 }));
      expect(result).toContain('1m 35s');
    });

    it('shows duration in hours for long runs', () => {
      const result = formatTelegramNotification(makeNotification({ durationMs: 3_720_000 }));
      expect(result).toContain('1h 2m');
    });

    it('shows file count when files were written', () => {
      const result = formatTelegramNotification(makeNotification({
        filesWritten: ['/home/user/report.md', '/home/user/data.json'],
      }));
      expect(result).toContain('2 files written');
    });

    it('uses singular for one file', () => {
      const result = formatTelegramNotification(makeNotification({
        filesWritten: ['/home/user/report.md'],
      }));
      expect(result).toContain('1 file written');
    });

    it('shows tool count when tools were used', () => {
      const result = formatTelegramNotification(makeNotification({
        toolsUsed: ['Read', 'Write', 'Bash'],
      }));
      expect(result).toContain('3 tools used');
    });

    it('lists file paths when five or fewer files were written', () => {
      const result = formatTelegramNotification(makeNotification({
        filesWritten: ['/home/user/report.md'],
      }));
      expect(result).toContain('<b>Files written:</b>');
      expect(result).toContain('<code>');
    });

    it('omits file listing when more than five files were written', () => {
      const files = Array.from({ length: 6 }, (_, i) => `/home/user/file-${i}.ts`);
      const result = formatTelegramNotification(makeNotification({ filesWritten: files }));
      expect(result).toContain('6 files written');
      expect(result).not.toContain('<b>Files written:</b>');
    });

    it('escapes HTML special characters in agent name', () => {
      const result = formatTelegramNotification(makeNotification({
        agentName: '<script>alert("xss")</script>',
      }));
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('escapes HTML special characters in summary', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: 'Used A > B & C < D logic',
      }));
      expect(result).toContain('A &gt; B &amp; C &lt; D');
    });
  });

  describe('failed notifications', () => {
    it('includes an X mark and the agent name in bold', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
      }));
      expect(result).toContain('\u274C');
      expect(result).toContain('<b>Daily Report</b>');
      expect(result).toContain('failed');
    });

    it('shows the error in a pre block', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
        error: 'Process exited with code 1',
      }));
      expect(result).toContain('<pre>Process exited with code 1</pre>');
    });

    it('escapes HTML in error messages', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
        error: 'TypeError: null > undefined & broken',
      }));
      expect(result).toContain('&gt;');
      expect(result).toContain('&amp;');
    });

    it('handles failure without error detail', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
      }));
      expect(result).toContain('failed');
      expect(result).not.toContain('<pre>');
    });
  });
});
