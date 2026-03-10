import { describe, it, expect, vi } from 'vitest';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';

describe('ProgressBroadcaster', () => {
  it('notifies subscribers of events', () => {
    const broadcaster = new ProgressBroadcaster();
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const event: ProgressEvent = {
      type: 'run_started',
      runId: 'r1',
      agentId: 'agent-1',
      timestamp: new Date().toISOString(),
    };
    broadcaster.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('notifies multiple subscribers', () => {
    const broadcaster = new ProgressBroadcaster();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    broadcaster.subscribe(listener1);
    broadcaster.subscribe(listener2);

    const event: ProgressEvent = {
      type: 'run_completed',
      runId: 'r1',
      agentId: 'agent-1',
      timestamp: new Date().toISOString(),
    };
    broadcaster.emit(event);

    expect(listener1).toHaveBeenCalledWith(event);
    expect(listener2).toHaveBeenCalledWith(event);
  });

  it('stops notifying after unsubscribe', () => {
    const broadcaster = new ProgressBroadcaster();
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    broadcaster.unsubscribe(listener);

    broadcaster.emit({
      type: 'run_started',
      runId: 'r1',
      agentId: 'agent-1',
      timestamp: new Date().toISOString(),
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('emits run_progress events with message and metadata', () => {
    const broadcaster = new ProgressBroadcaster();
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const event: ProgressEvent = {
      type: 'run_progress',
      runId: 'r1',
      agentId: 'agent-1',
      message: 'Working on step 1',
      timestamp: new Date().toISOString(),
      metadata: { turns_completed: 3 },
    };
    broadcaster.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('emits run_failed events with error', () => {
    const broadcaster = new ProgressBroadcaster();
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const event: ProgressEvent = {
      type: 'run_failed',
      runId: 'r1',
      agentId: 'agent-1',
      error: 'Something broke',
      timestamp: new Date().toISOString(),
    };
    broadcaster.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('handles subscriber errors without affecting other subscribers', () => {
    const broadcaster = new ProgressBroadcaster();
    const badListener = vi.fn().mockImplementation(() => {
      throw new Error('listener error');
    });
    const goodListener = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    broadcaster.subscribe(badListener);
    broadcaster.subscribe(goodListener);

    broadcaster.emit({
      type: 'run_started',
      runId: 'r1',
      agentId: 'agent-1',
      timestamp: new Date().toISOString(),
    });

    expect(goodListener).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
