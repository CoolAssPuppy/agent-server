import type { NotificationData } from '../interaction/notification.js';
import { buildStatsFooter } from './notification-format.js';

function stripMarkdown(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  const codeBlockLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        output.push(codeBlockLines.join('\n'));
        codeBlockLines.length = 0;
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (trimmed === '') {
      output.push('');
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      output.push(stripInline(headingMatch[1]).toUpperCase());
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      output.push('\u2500\u2500\u2500');
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      output.push(`  \u2022 ${stripInline(trimmed.slice(2))}`);
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      output.push(`  ${numMatch[1]}. ${stripInline(numMatch[2])}`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      output.push(`\u2502 ${stripInline(trimmed.slice(2))}`);
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.includes('---')) continue;
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      output.push(cells.join(' | '));
      continue;
    }

    output.push(stripInline(trimmed));
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(codeBlockLines.join('\n'));
  }

  return collapseBlankLines(output.join('\n'));
}

function stripInline(text: string): string {
  let result = text;

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // Italic
  result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '$1');
  result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '$1');

  // Inline code
  result = result.replace(/`([^`]+?)`/g, '$1');

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Links: keep the label, drop the URL
  result = result.replace(/\[([^\]]+?)\]\([^)]+?\)/g, '$1');

  return result;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

export function formatTelegramNotification(data: NotificationData): string {
  const lines: string[] = [];

  if (data.status === 'completed') {
    lines.push(`\u2705 ${data.agentName} completed`);
  } else if (data.status === 'skipped') {
    lines.push(`${data.agentName} did not start`);
  } else {
    lines.push(`\u274C ${data.agentName} failed`);
  }

  lines.push('');

  if (data.status === 'completed') {
    if (data.summary) {
      lines.push(stripMarkdown(data.summary));
    }

    const statsFooter = buildStatsFooter(data);
    if (statsFooter) {
      lines.push('');
      lines.push(statsFooter);
    }
  } else {
    if (data.error) {
      lines.push(data.error);
    }
  }

  return lines.join('\n');
}

export { stripMarkdown as markdownToPlainText };
