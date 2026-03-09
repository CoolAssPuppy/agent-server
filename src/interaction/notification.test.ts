import { describe, it, expect } from 'vitest';
import { formatCompletionNotification, formatFailureNotification } from './notification.js';

describe('formatCompletionNotification', () => {
  it('formats a completion notification with summary', () => {
    const message = formatCompletionNotification('Weekly Report', 'Created report in Notion');
    expect(message).toContain('Weekly Report');
    expect(message).toContain('completed');
    expect(message).toContain('Created report in Notion');
  });

  it('formats a completion notification without summary', () => {
    const message = formatCompletionNotification('Daily Standup');
    expect(message).toContain('Daily Standup');
    expect(message).toContain('completed');
  });
});

describe('formatFailureNotification', () => {
  it('formats a failure notification with error message', () => {
    const message = formatFailureNotification('Weekly Report', 'Process exited with code 1');
    expect(message).toContain('Weekly Report');
    expect(message).toContain('failed');
    expect(message).toContain('Process exited with code 1');
  });

  it('formats a failure notification without error', () => {
    const message = formatFailureNotification('Daily Standup');
    expect(message).toContain('Daily Standup');
    expect(message).toContain('failed');
  });
});
