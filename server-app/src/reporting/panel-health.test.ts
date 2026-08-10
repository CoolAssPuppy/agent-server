import { describe, it, expect } from 'vitest';

import { PanelHealth } from './panel-health.js';

/**
 * Panel reporting health, from the point of view of somebody whose runs
 * stopped showing up in Panel and who had no way to know.
 */
describe('PanelHealth', () => {
  const at = (iso: string) => new Date(iso);

  it('starts with nothing to report', () => {
    const health = new PanelHealth();

    expect(health.snapshot()).toEqual({
      state: 'unknown',
      last_success_at: null,
      last_failure_at: null,
      last_failure: null,
      consecutive_failures: 0,
    });
  });

  it('reports ok after a delivery lands', () => {
    const health = new PanelHealth();

    health.recordSuccess(at('2026-08-10T06:00:00Z'));

    expect(health.snapshot()).toMatchObject({
      state: 'ok',
      last_success_at: '2026-08-10T06:00:00.000Z',
      consecutive_failures: 0,
    });
  });

  it('does not call one dropped request an outage', () => {
    // Heartbeats go out every minute. A single blip self-heals before
    // anybody could act on it, and alarming on it teaches people to
    // ignore the alarm.
    const health = new PanelHealth();
    health.recordSuccess(at('2026-08-10T06:00:00Z'));

    health.recordFailure('HTTP 500', at('2026-08-10T06:01:00Z'));

    expect(health.snapshot()).toMatchObject({
      state: 'ok',
      consecutive_failures: 1,
      last_failure: 'HTTP 500',
    });
  });

  it('calls three consecutive failures failing', () => {
    const health = new PanelHealth();
    health.recordSuccess(at('2026-08-10T06:00:00Z'));
    health.recordFailure('HTTP 401', at('2026-08-10T06:01:00Z'));
    health.recordFailure('HTTP 401', at('2026-08-10T06:02:00Z'));
    health.recordFailure('HTTP 401', at('2026-08-10T06:03:00Z'));

    expect(health.snapshot()).toMatchObject({
      state: 'failing',
      last_failure: 'HTTP 401',
      last_failure_at: '2026-08-10T06:03:00.000Z',
      // The last time anything got through survives, so a person can see
      // how long this has been going on.
      last_success_at: '2026-08-10T06:00:00.000Z',
      consecutive_failures: 3,
    });
  });

  it('recovers the moment a delivery lands again', () => {
    const health = new PanelHealth();
    for (let i = 0; i < 5; i += 1) health.recordFailure('HTTP 401', at('2026-08-10T06:01:00Z'));

    health.recordSuccess(at('2026-08-10T06:06:00Z'));

    expect(health.snapshot()).toMatchObject({ state: 'ok', consecutive_failures: 0 });
  });

  it('keeps failure text short enough for a status line', () => {
    const health = new PanelHealth();

    health.recordFailure('x'.repeat(500), at('2026-08-10T06:01:00Z'));

    expect(health.snapshot().last_failure!.length).toBeLessThanOrEqual(200);
  });
});
