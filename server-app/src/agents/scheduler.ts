import { CronExpressionParser } from 'cron-parser';
import type { AgentConfig } from './config.js';

export function shouldRun(agent: AgentConfig, now: Date): boolean {
  if (!agent.enabled) return false;
  if (!agent.schedule) return false;

  const truncated = new Date(now);
  truncated.setSeconds(0, 0);

  try {
    const expr = CronExpressionParser.parse(agent.schedule, {
      tz: agent.timezone,
    });
    return expr.includesDate(truncated);
  } catch {
    console.warn(`Invalid cron expression for agent "${agent.id}": ${agent.schedule}`);
    return false;
  }
}

export function hasMissedRun(agent: AgentConfig, since: Date, now: Date): boolean {
  if (!agent.enabled) return false;
  if (!agent.schedule) return false;

  try {
    const expr = CronExpressionParser.parse(agent.schedule, {
      currentDate: since,
      tz: agent.timezone,
    });

    const next = expr.next().toDate();
    return next <= now;
  } catch {
    return false;
  }
}

export function getNextRun(agent: AgentConfig, now: Date): Date | undefined {
  if (!agent.schedule) return undefined;

  const expr = CronExpressionParser.parse(agent.schedule, {
    currentDate: now,
    tz: agent.timezone,
  });

  return expr.next().toDate();
}
