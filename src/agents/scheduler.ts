import { CronExpressionParser } from 'cron-parser';
import type { AgentConfig } from './config.js';

export function shouldRun(agent: AgentConfig, now: Date): boolean {
  if (!agent.enabled) return false;

  const truncated = new Date(now);
  truncated.setSeconds(0, 0);

  const expr = CronExpressionParser.parse(agent.schedule, {
    tz: agent.timezone,
  });

  return expr.includesDate(truncated);
}

export function getNextRun(agent: AgentConfig, now: Date): Date {
  const expr = CronExpressionParser.parse(agent.schedule, {
    currentDate: now,
    tz: agent.timezone,
  });

  return expr.next().toDate();
}
