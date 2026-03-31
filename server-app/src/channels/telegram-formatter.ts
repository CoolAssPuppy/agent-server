import type { NotificationData } from '../interaction/notification.js';

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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}

export function formatTelegramNotification(data: NotificationData): string {
  const lines: string[] = [];

  if (data.status === 'completed') {
    lines.push(`\u2705 ${data.agentName} completed`);
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

function buildStatsFooter(data: NotificationData): string | null {
  const parts: string[] = [];

  if (data.turnCount && data.turnCount > 0) {
    parts.push(`${data.turnCount} turns`);
  }

  if (data.durationMs && data.durationMs > 0) {
    parts.push(formatDuration(data.durationMs));
  }

  if (data.toolsUsed && data.toolsUsed.length > 0) {
    parts.push(`${data.toolsUsed.length} tools`);
  }

  if (data.filesWritten && data.filesWritten.length > 0) {
    parts.push(`${data.filesWritten.length} file${data.filesWritten.length === 1 ? '' : 's'} written`);
  }

  return parts.length > 0 ? parts.join(' \u00B7 ') : null;
}

export { stripMarkdown as markdownToPlainText };
