import type { NotificationData } from '../interaction/notification.js';
import { markdownToPlainText } from './telegram-formatter.js';

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

function buildStatsFooter(data: NotificationData): string | null {
  const parts: string[] = [];
  if (data.turnCount && data.turnCount > 0) parts.push(`${data.turnCount} turns`);
  if (data.durationMs && data.durationMs > 0) parts.push(formatDuration(data.durationMs));
  if (data.toolsUsed && data.toolsUsed.length > 0) parts.push(`${data.toolsUsed.length} tools`);
  if (data.filesWritten && data.filesWritten.length > 0) {
    parts.push(`${data.filesWritten.length} file${data.filesWritten.length === 1 ? '' : 's'} written`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * A run notification as plain text for Slack. Markdown from the agent's summary
 * is flattened the same way as Telegram — Slack renders our plain output
 * cleanly and it avoids mrkdwn escaping surprises.
 */
export function formatSlackNotification(data: NotificationData): string {
  const lines: string[] = [];

  if (data.status === 'completed') {
    lines.push(`✅ ${data.agentName} completed`);
  } else {
    lines.push(`❌ ${data.agentName} failed`);
  }

  lines.push('');

  if (data.status === 'completed') {
    if (data.summary) lines.push(markdownToPlainText(data.summary));
    const statsFooter = buildStatsFooter(data);
    if (statsFooter) {
      lines.push('');
      lines.push(statsFooter);
    }
  } else if (data.error) {
    lines.push(data.error);
  }

  return lines.join('\n');
}
