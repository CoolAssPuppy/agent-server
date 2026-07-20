import { describe, it, expect } from 'vitest';
import { InteractionStore } from './store.js';

function makeRequest() {
  return {
    message: 'Pick one',
    options: [{ label: 'A', value: 'a' }],
    freeText: false as const,
  };
}

describe('InteractionStore', () => {
  it('adds and retrieves a pending interaction', () => {
    const store = new InteractionStore();
    store.add({
      id: 'int-1',
      runId: 'run-1',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = store.get('int-1');
    expect(found).toBeDefined();
    expect(found!.status).toBe('pending');
    expect(found!.replyAgentId).toBe('booker');
  });

  it('returns undefined for unknown interaction', () => {
    const store = new InteractionStore();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('marks interaction as acted', () => {
    const store = new InteractionStore();
    store.add({
      id: 'int-1',
      runId: 'run-1',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    store.markActed('int-1');
    expect(store.get('int-1')!.status).toBe('acted');
  });

  it('removes an interaction when delivery fails', () => {
    const store = new InteractionStore();
    store.add({
      id: 'int-1',
      runId: 'run-1',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    store.remove('int-1');

    expect(store.get('int-1')).toBeUndefined();
  });

  it('expires stale interactions', () => {
    const store = new InteractionStore();
    const pastDate = new Date(Date.now() - 1000);

    store.add({
      id: 'int-expired',
      runId: 'run-1',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: pastDate,
    });

    store.add({
      id: 'int-valid',
      runId: 'run-2',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const expired = store.expireStale();
    expect(expired).toHaveLength(1);
    expect(expired[0]).toBe('int-expired');
    expect(store.get('int-expired')!.status).toBe('expired');
    expect(store.get('int-valid')!.status).toBe('pending');
  });

  it('lists pending interactions', () => {
    const store = new InteractionStore();
    store.add({
      id: 'int-1',
      runId: 'run-1',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    store.add({
      id: 'int-2',
      runId: 'run-2',
      agentId: 'checker',
      replyAgentId: 'booker',
      request: makeRequest(),
      channel: 'console',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    store.markActed('int-1');

    const pending = store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('int-2');
  });
});
