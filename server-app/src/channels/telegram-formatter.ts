import type { NotificationData } from '../interaction/notification.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function markdownToTelegramHtml(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        output.push(`<pre>${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
        codeBlockLines = [];
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

    // Headings -> bold
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      output.push(`<b>${inlineToHtml(headingMatch[1])}</b>`);
      continue;
    }

    // Horizontal rules
    if (/^[-*_]{3,}$/.test(trimmed)) {
      output.push('\u2500\u2500\u2500');
      continue;
    }

    // Bullet lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.slice(2);
      output.push(`  \u2022 ${inlineToHtml(content)}`);
      continue;
    }

    // Numbered lists
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      output.push(`  ${numMatch[1]}. ${inlineToHtml(numMatch[2])}`);
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith('> ')) {
      const content = trimmed.slice(2);
      output.push(`\u2502 <i>${inlineToHtml(content)}</i>`);
      continue;
    }

    // Table rows -> monospaced
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.includes('---')) continue; // skip separator rows
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      output.push(`<code>${escapeHtml(cells.join(' | '))}</code>`);
      continue;
    }

    // Regular paragraph
    output.push(inlineToHtml(trimmed));
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(`<pre>${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
  }

  return collapseBlankLines(output.join('\n'));
}

function inlineToHtml(text: string): string {
  let result = escapeHtml(text);

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (but not inside words with underscores)
  result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

  // Inline code: `text`
  result = result.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url)
  result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');

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

function abbreviatePath(path: string): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (homeDir && path.startsWith(homeDir)) {
    return '~' + path.slice(homeDir.length);
  }
  return path;
}

export function formatTelegramNotification(data: NotificationData): string {
  const lines: string[] = [];

  if (data.status === 'completed') {
    lines.push(`\u2705 <b>${escapeHtml(data.agentName)}</b> completed`);
  } else {
    lines.push(`\u274C <b>${escapeHtml(data.agentName)}</b> failed`);
  }

  lines.push('');

  if (data.status === 'completed') {
    const stats: string[] = [];

    if (data.turnCount && data.turnCount > 0) {
      stats.push(`\u{1F504} ${data.turnCount} turns`);
    }

    if (data.durationMs && data.durationMs > 0) {
      stats.push(`\u23F1 ${formatDuration(data.durationMs)}`);
    }

    if (data.filesWritten && data.filesWritten.length > 0) {
      stats.push(`\u{1F4DD} ${data.filesWritten.length} file${data.filesWritten.length === 1 ? '' : 's'} written`);
    }

    if (data.toolsUsed && data.toolsUsed.length > 0) {
      stats.push(`\u{1F6E0} ${data.toolsUsed.length} tool${data.toolsUsed.length === 1 ? '' : 's'} used`);
    }

    if (stats.length > 0) {
      lines.push(stats.join('  \u00B7  '));
      lines.push('');
    }

    if (data.summary) {
      lines.push(markdownToTelegramHtml(data.summary));
    }

    if (data.filesWritten && data.filesWritten.length > 0 && data.filesWritten.length <= 5) {
      lines.push('');
      lines.push('<b>Files written:</b>');
      for (const file of data.filesWritten) {
        lines.push(`  <code>${escapeHtml(abbreviatePath(file))}</code>`);
      }
    }
  } else {
    if (data.error) {
      lines.push(`<pre>${escapeHtml(data.error)}</pre>`);
    }
  }

  return lines.join('\n');
}
