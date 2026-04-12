import { CronExpressionParser } from 'cron-parser';
export function shouldRun(agent, now) {
    if (!agent.enabled)
        return false;
    if (!agent.schedule)
        return false;
    const truncated = new Date(now);
    truncated.setSeconds(0, 0);
    try {
        const expr = CronExpressionParser.parse(agent.schedule, {
            tz: agent.timezone,
        });
        return expr.includesDate(truncated);
    }
    catch {
        console.warn(`Invalid cron expression for agent "${agent.id}": ${agent.schedule}`);
        return false;
    }
}
export function hasMissedRun(agent, since, now) {
    if (!agent.enabled)
        return false;
    if (!agent.schedule)
        return false;
    try {
        const expr = CronExpressionParser.parse(agent.schedule, {
            currentDate: since,
            tz: agent.timezone,
        });
        const next = expr.next().toDate();
        return next <= now;
    }
    catch {
        return false;
    }
}
export function getNextRun(agent, now) {
    if (!agent.schedule)
        return undefined;
    const expr = CronExpressionParser.parse(agent.schedule, {
        currentDate: now,
        tz: agent.timezone,
    });
    return expr.next().toDate();
}
//# sourceMappingURL=scheduler.js.map