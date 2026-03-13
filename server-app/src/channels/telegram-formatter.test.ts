import { describe, it, expect } from 'vitest';
import { formatTelegramNotification, markdownToTelegramHtml } from './telegram-formatter.js';
import type { NotificationData } from '../interaction/notification.js';

function makeNotification(overrides: Partial<NotificationData> = {}): NotificationData {
  return {
    agentName: 'Daily Report',
    status: 'completed',
    ...overrides,
  };
}

describe('markdownToTelegramHtml', () => {
  it('converts headings to bold text', () => {
    expect(markdownToTelegramHtml('# Title')).toBe('<b>Title</b>');
    expect(markdownToTelegramHtml('## Subtitle')).toBe('<b>Subtitle</b>');
    expect(markdownToTelegramHtml('### Section')).toBe('<b>Section</b>');
  });

  it('converts bold markdown to HTML bold', () => {
    expect(markdownToTelegramHtml('This is **bold** text')).toBe('This is <b>bold</b> text');
  });

  it('converts italic markdown to HTML italic', () => {
    expect(markdownToTelegramHtml('This is *italic* text')).toBe('This is <i>italic</i> text');
  });

  it('converts inline code to HTML code', () => {
    expect(markdownToTelegramHtml('Use `npm install`')).toBe('Use <code>npm install</code>');
  });

  it('converts fenced code blocks to pre tags', () => {
    const md = '```\nconst x = 1;\nconst y = 2;\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre>const x = 1;\nconst y = 2;</pre>');
  });

  it('strips the language identifier from code blocks', () => {
    const md = '```typescript\nconst x = 1;\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre>const x = 1;</pre>');
  });

  it('converts bullet lists with bullet character', () => {
    const md = '- First item\n- Second item';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('\u2022 First item');
    expect(result).toContain('\u2022 Second item');
  });

  it('converts asterisk bullet lists', () => {
    const md = '* Alpha\n* Beta';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('\u2022 Alpha');
    expect(result).toContain('\u2022 Beta');
  });

  it('converts numbered lists', () => {
    const md = '1. First\n2. Second';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('1. First');
    expect(result).toContain('2. Second');
  });

  it('converts blockquotes to italic with a bar', () => {
    const result = markdownToTelegramHtml('> Important note');
    expect(result).toContain('\u2502');
    expect(result).toContain('<i>Important note</i>');
  });

  it('converts links to HTML anchors', () => {
    const result = markdownToTelegramHtml('See [docs](https://example.com)');
    expect(result).toContain('<a href="https://example.com">docs</a>');
  });

  it('converts strikethrough to HTML strikethrough', () => {
    expect(markdownToTelegramHtml('~~removed~~')).toBe('<s>removed</s>');
  });

  it('converts horizontal rules to line characters', () => {
    expect(markdownToTelegramHtml('---')).toBe('\u2500\u2500\u2500');
  });

  it('renders table rows as monospaced text', () => {
    const md = '| Name | Value |\n|---|---|\n| foo | 42 |';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('<code>Name | Value</code>');
    expect(result).toContain('<code>foo | 42</code>');
    expect(result).not.toContain('---');
  });

  it('escapes HTML characters in content', () => {
    expect(markdownToTelegramHtml('A > B & C < D')).toBe('A &gt; B &amp; C &lt; D');
  });

  it('collapses multiple blank lines', () => {
    const md = 'First\n\n\n\nSecond';
    const result = markdownToTelegramHtml(md);
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

    const result = markdownToTelegramHtml(md);
    expect(result).toContain('<b>Summary</b>');
    expect(result).toContain('<b>completed</b>');
    expect(result).toContain('\u2022 Read 3 files');
    expect(result).toContain('<code>output.json</code>');
    expect(result).toContain('<pre>echo "done"</pre>');
  });
});

describe('formatTelegramNotification', () => {
  describe('completed notifications', () => {
    it('includes a checkmark and the agent name in bold', () => {
      const result = formatTelegramNotification(makeNotification());
      expect(result).toContain('\u2705');
      expect(result).toContain('<b>Daily Report</b>');
      expect(result).toContain('completed');
    });

    it('renders summary markdown as Telegram HTML', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: '**3 reports** created in `Notion`',
      }));
      expect(result).toContain('<b>3 reports</b>');
      expect(result).toContain('<code>Notion</code>');
    });

    it('places stats in a compact italic footer after the summary', () => {
      const result = formatTelegramNotification(makeNotification({
        summary: 'Done.',
        turnCount: 12,
        durationMs: 95000,
        toolsUsed: ['Read', 'Write', 'Bash'],
      }));
      const lines = result.split('\n');
      const summaryIndex = lines.findIndex((l) => l.includes('Done.'));
      const footerIndex = lines.findIndex((l) => l.includes('<i>'));
      expect(footerIndex).toBeGreaterThan(summaryIndex);
      expect(lines[footerIndex]).toContain('12 turns');
      expect(lines[footerIndex]).toContain('1m 35s');
      expect(lines[footerIndex]).toContain('3 tools');
    });

    it('does not use emoji in stats footer', () => {
      const result = formatTelegramNotification(makeNotification({
        turnCount: 12,
        durationMs: 95000,
        toolsUsed: ['Read', 'Write'],
        filesWritten: ['/a.ts'],
      }));
      const lines = result.split('\n');
      const footerLine = lines.find((l) => l.includes('<i>')) ?? '';
      expect(footerLine).not.toMatch(/[\u{1F504}\u23F1\u{1F4DD}\u{1F6E0}]/u);
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
      expect(result).not.toContain('<b>Files written:</b>');
      expect(result).not.toContain('report.md');
    });

    it('escapes HTML special characters in agent name', () => {
      const result = formatTelegramNotification(makeNotification({
        agentName: '<script>alert("xss")</script>',
      }));
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('omits footer when no stats are available', () => {
      const result = formatTelegramNotification(makeNotification());
      expect(result).not.toContain('<i>');
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
