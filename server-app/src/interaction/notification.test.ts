import { describe, it, expect } from 'vitest';
import { formatCompletionNotification, formatFailureNotification, formatAgentListMessage, formatPlainNotification } from './notification.js';
import { makeAgent } from '../test-factories.js';

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

describe('formatAgentListMessage', () => {
  it('lists agents with name and description', () => {
    const agents = [
      makeAgent({ id: 'restaurant-checker', name: 'Restaurant Checker', description: 'Checks availability' }),
      makeAgent({ id: 'daily-standup', name: 'Daily Standup', description: 'Generates standup summaries' }),
    ];

    const message = formatAgentListMessage(agents);

    expect(message).toContain('Restaurant Checker');
    expect(message).toContain('Checks availability');
    expect(message).toContain('Daily Standup');
    expect(message).toContain('Generates standup summaries');
  });

  it('shows schedule for scheduled agents', () => {
    const agents = [
      makeAgent({ id: 'scheduled', name: 'Scheduled Agent', schedule: '0 9 * * *' }),
    ];

    const message = formatAgentListMessage(agents);
    expect(message).toContain('0 9 * * *');
  });

  it('shows on-demand for agents without a schedule', () => {
    const agents = [
      makeAgent({ id: 'on-demand', name: 'On Demand Agent', schedule: undefined }),
    ];

    const message = formatAgentListMessage(agents);
    expect(message).toContain('On-demand');
  });

  it('returns a fallback message when no agents are installed', () => {
    const message = formatAgentListMessage([]);
    expect(message).toContain('No agents');
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

describe('formatPlainNotification', () => {
  it('delegates to completion formatter for completed status', () => {
    const message = formatPlainNotification({
      agentName: 'Weekly Report',
      status: 'completed',
      summary: 'Created 3 reports',
    });
    expect(message).toContain('Weekly Report');
    expect(message).toContain('completed');
    expect(message).toContain('Created 3 reports');
  });

  it('delegates to failure formatter for failed status', () => {
    const message = formatPlainNotification({
      agentName: 'Daily Standup',
      status: 'failed',
      error: 'Timed out',
    });
    expect(message).toContain('Daily Standup');
    expect(message).toContain('failed');
    expect(message).toContain('Timed out');
  });

  it('describes skipped runs without calling them failures', () => {
    const message = formatPlainNotification({
      agentName: 'Daily Standup',
      status: 'skipped',
      error: 'Already running',
    });
    expect(message).toContain('did not start');
    expect(message).toContain('Already running');
    expect(message).not.toContain('failed');
  });
});
