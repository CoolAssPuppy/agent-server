import { describe, it, expect } from 'vitest';
import { shouldRun, getNextRun } from './scheduler.js';
import type { AgentConfig } from './config.js';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test',
    name: 'Test Agent',
    schedule: '* * * * *',
    prompt: 'Do something.',
    tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

describe('shouldRun', () => {
  it('returns true when cron matches current minute', () => {
    const agent = makeAgent({ schedule: '* * * * *' });
    const now = new Date('2026-03-09T10:00:00Z');
    expect(shouldRun(agent, now)).toBe(true);
  });

  it('returns false when cron does not match', () => {
    const agent = makeAgent({ schedule: '30 10 * * *' });
    const now = new Date('2026-03-09T10:00:00Z');
    expect(shouldRun(agent, now)).toBe(false);
  });

  it('returns true at exact cron match', () => {
    const agent = makeAgent({ schedule: '30 10 * * *' });
    const now = new Date('2026-03-09T10:30:00Z');
    expect(shouldRun(agent, now)).toBe(true);
  });

  it('returns false for disabled agents', () => {
    const agent = makeAgent({ schedule: '* * * * *', enabled: false });
    const now = new Date('2026-03-09T10:00:00Z');
    expect(shouldRun(agent, now)).toBe(false);
  });

  it('ignores seconds in the time check', () => {
    const agent = makeAgent({ schedule: '0 10 * * *' });
    const at45sec = new Date('2026-03-09T10:00:45Z');
    expect(shouldRun(agent, at45sec)).toBe(true);
  });

  it('handles complex cron expressions', () => {
    const agent = makeAgent({ schedule: '*/15 9-17 * * 1-5' });
    const mondayAt915 = new Date('2026-03-09T09:15:00Z');
    expect(shouldRun(agent, mondayAt915)).toBe(true);
    const sundayAt915 = new Date('2026-03-08T09:15:00Z');
    expect(shouldRun(agent, sundayAt915)).toBe(false);
  });

  it('handles timezone-aware scheduling', () => {
    const agent = makeAgent({
      schedule: '0 8 * * *',
      timezone: 'Europe/Lisbon',
    });
    const utc8am = new Date('2026-03-09T08:00:00Z');
    expect(shouldRun(agent, utc8am)).toBe(true);
  });

  it('returns false for agents without a schedule', () => {
    const agent = makeAgent({ schedule: undefined });
    const now = new Date('2026-03-09T10:00:00Z');
    expect(shouldRun(agent, now)).toBe(false);
  });

  it('returns false for invalid cron expressions instead of throwing', () => {
    const agent = makeAgent({ schedule: '0 0 31 2 *' });
    const now = new Date('2026-03-09T10:00:00Z');
    expect(shouldRun(agent, now)).toBe(false);
  });
});

describe('getNextRun', () => {
  it('returns the next run time for a cron expression', () => {
    const agent = makeAgent({ schedule: '0 10 * * *' });
    const now = new Date('2026-03-09T08:00:00Z');
    const next = getNextRun(agent, now);
    expect(next.getUTCHours()).toBe(10);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('returns next day if todays run already passed', () => {
    const agent = makeAgent({ schedule: '0 8 * * *' });
    const now = new Date('2026-03-09T10:00:00Z');
    const next = getNextRun(agent, now);
    expect(next.getUTCDate()).toBe(10);
    expect(next.getUTCHours()).toBe(8);
  });
});
