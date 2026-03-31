import { describe, it, expect } from 'vitest';
import { formatTelegramNotification, markdownToPlainText } from './telegram-formatter.js';
import type { NotificationData } from '../interaction/notification.js';

function makeNotification(overrides: Partial<NotificationData> = {}): NotificationData {
  return {
    agentName: 'Daily Report',
    status: 'completed',
    ...overrides,
  };
}

describe('markdownToPlainText', () => {
  it('converts headings to uppercase text', () => {
    expect(markdownToPlainText('# Title')).toBe('TITLE');
    expect(markdownToPlainText('## Subtitle')).toBe('SUBTITLE');
    expect(markdownToPlainText('### Section')).toBe('SECTION');
  });

  it('strips bold markdown', () => {
    expect(markdownToPlainText('This is **bold** text')).toBe('This is bold text');
  });

  it('strips italic markdown', () => {
    expect(markdownToPlainText('This is *italic* text')).toBe('This is italic text');
  });

  it('strips inline code backticks', () => {
    expect(markdownToPlainText('Use `npm install`')).toBe('Use npm install');
  });

  it('preserves code block content without fences', () => {
    const md = '```\nconst x = 1;\nconst y = 2;\n```';
    expect(markdownToPlainText(md)).toBe('const x = 1;\nconst y = 2;');
  });

  it('strips the language identifier from code blocks', () => {
    const md = '```typescript\nconst x = 1;\n```';
    expect(markdownToPlainText(md)).toBe('const x = 1;');
  });

  it('converts bullet lists with bullet character', () => {
    const md = '- First item\n- Second item';
    const result = markdownToPlainText(md);
    expect(result).toContain('\u2022 First item');
    expect(result).toContain('\u2022 Second item');
  });

  it('converts asterisk bullet lists', () => {
    const md = '* Alpha\n* Beta';
    const result = markdownToPlainText(md);
    expect(result).toContain('\u2022 Alpha');
    expect(result).toContain('\u2022 Beta');
  });

  it('converts numbered lists', () => {
    const md = '1. First\n2. Second';
    const result = markdownToPlainText(md);
    expect(result).toContain('1. First');
    expect(result).toContain('2. Second');
  });

  it('converts blockquotes with a bar', () => {
    const result = markdownToPlainText('> Important note');
    expect(result).toContain('\u2502');
    expect(result).toContain('Important note');
  });

  it('keeps link label and drops URL', () => {
    const result = markdownToPlainText('See [docs](https://example.com)');
    expect(result).toBe('See docs');
    expect(result).not.toContain('https://');
  });

  it('strips strikethrough markers', () => {
    expect(markdownToPlainText('~~removed~~')).toBe('removed');
  });

  it('converts horizontal rules to line characters', () => {
    expect(markdownToPlainText('---')).toBe('\u2500\u2500\u2500');
  });

  it('renders table rows as plain text', () => {
    const md = '| Name | Value |\n|---|---|\n| foo | 42 |';
    const result = markdownToPlainText(md);
    expect(result).toContain('Name | Value');
    expect(result).toContain('foo | 42');
    expect(result).not.toContain('---');
  });

  it('does not escape HTML characters', () => {
    expect(markdownToPlainText('A > B & C < D')).toBe('A > B & C < D');
  });

  it('collapses multiple blank lines', () => {
    const md = 'First\n\n\n\nSecond';
    const result = markdownToPlainText(md);
    expect(result).toBe('First\n\nSecond');
  });

  it('handles mixed markdown content', () => {
    const md = [
      '# Summary',
      '',
      'The agent **completed** all tasks.',
      '',
      '- Read 3 files',
      '- Wrote `output.json`',
      '',
      '```',
      'echo "done"',
      '```',
    ].join('\n');

    const result = markdownToPlainText(md);
    expect(result).toContain('SUMMARY');
    expect(result).toContain('completed');
    expect(result).not.toContain('**');
    expect(result).toContain('\u2022 Read 3 files');
    expect(result).toContain('output.json');
    expect(result).not.toContain('`');
    expect(result).toContain('echo "done"');
  });
});

describe('formatTelegramNotification', () => {
  describe('completed notifications', () => {
    it('includes a checkmark and the agent name', () => {
      const result = formatTelegramNotification(makeNotification());
      expect(result).toContain('\u2705');
      expect(result).toContain('Daily Report');
      expect(result).toContain('completed');
    });

    it('strips markdown from summary', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: '**3 reports** created in `Notion`',
      }));
      expect(result).toContain('3 reports');
      expect(result).toContain('Notion');
      expect(result).not.toContain('**');
      expect(result).not.toContain('`');
    });

    it('places stats in a compact footer after the summary', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: 'Done.',
        turnCount: 12,
        durationMs: 95000,
        toolsUsed: ['Read', 'Write', 'Bash'],
      }));
      const lines = result.split('\n');
      const summaryIndex = lines.findIndex((l) => l.includes('Done.'));
      const footerIndex = lines.findIndex((l) => l.includes('12 turns'));
      expect(footerIndex).toBeGreaterThan(summaryIndex);
      expect(lines[footerIndex]).toContain('1m 35s');
      expect(lines[footerIndex]).toContain('3 tools');
    });

    it('shows turn count in footer', () => {
      const result = formatTelegramNotification(makeNotification({ turnCount: 12 }));
      expect(result).toContain('12 turns');
    });

    it('shows duration in footer', () => {
      const result = formatTelegramNotification(makeNotification({ durationMs: 95000 }));
      expect(result).toContain('1m 35s');
    });

    it('shows duration in hours for long runs', () => {
      const result = formatTelegramNotification(makeNotification({ durationMs: 3_720_000 }));
      expect(result).toContain('1h 2m');
    });

    it('shows file count in footer when files were written', () => {
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

    it('shows tool count in footer', () => {
      const result = formatTelegramNotification(makeNotification({
        toolsUsed: ['Read', 'Write', 'Bash'],
      }));
      expect(result).toContain('3 tools');
    });

    it('does not list individual file paths', () => {
      const result = formatTelegramNotification(makeNotification({
        filesWritten: ['/home/user/report.md'],
      }));
      expect(result).not.toContain('report.md');
    });

    it('omits footer when no stats are available', () => {
      const result = formatTelegramNotification(makeNotification());
      expect(result).not.toContain('turns');
    });
  });

  describe('failed notifications', () => {
    it('includes an X mark and the agent name', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
      }));
      expect(result).toContain('\u274C');
      expect(result).toContain('Daily Report');
      expect(result).toContain('failed');
    });

    it('shows the error as plain text', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
        error: 'Process exited with code 1',
      }));
      expect(result).toContain('Process exited with code 1');
    });

    it('preserves special characters in error messages', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
        error: 'TypeError: null > undefined & broken',
      }));
      expect(result).toContain('null > undefined & broken');
    });

    it('handles failure without error detail', () => {
      const result = formatTelegramNotification(makeNotification({
        status: 'failed',
      }));
      expect(result).toContain('failed');
    });
  });
});
