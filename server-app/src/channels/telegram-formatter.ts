import type { NotificationData } from '../interaction/notification.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      lines.push(escapeHtml(data.summary));
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
