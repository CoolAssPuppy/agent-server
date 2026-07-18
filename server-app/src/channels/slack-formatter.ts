import type { NotificationData } from '../interaction/notification.js';
import { markdownToPlainText } from './telegram-formatter.js';
import { buildStatsFooter } from './notification-format.js';

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
