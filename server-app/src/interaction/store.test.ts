import { describe, it, expect } from 'vitest';
import {
  InteractionStore,
  MAX_INTERACTION_RESPONSE_TEXT_LENGTH,
} from './store.js';

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

  describe('response claims', () => {
    const validUntil = new Date('2026-08-02T12:30:00.000Z');
    const claimTime = new Date('2026-08-02T12:00:00.000Z');

    function makeStore(request = makeRequest()) {
      const store = new InteractionStore(() => 'claim-token');
      store.add({
        id: 'int-claim',
        runId: 'run-claim',
        agentId: 'checker',
        replyAgentId: 'booker',
        request,
        channel: 'http',
        createdAt: new Date('2026-08-02T11:59:00.000Z'),
        expiresAt: validUntil,
      });
      return store;
    }

    it('claims an option using the value held by the server', () => {
      const store = makeStore({
        message: 'Pick one',
        options: [
          { label: 'Morning', value: 'book-09:00' },
          { label: 'Evening', value: 'book-18:00' },
        ],
        freeText: false,
      });

      const result = store.claim(
        'int-claim',
        { type: 'option', optionIndex: 1 },
        claimTime,
      );

      expect(result).toEqual({
        ok: true,
        claim: {
          interactionId: 'int-claim',
          claimToken: 'claim-token',
          replyAgentId: 'booker',
          response: {
            type: 'option',
            optionIndex: 1,
            label: 'Evening',
            value: 'book-18:00',
          },
        },
      });
      expect(store.get('int-claim')?.status).toBe('processing');
    });

    it.each([-1, 1, 0.5])('rejects invalid option index %s', (optionIndex) => {
      const store = makeStore();

      expect(
        store.claim('int-claim', { type: 'option', optionIndex }, claimTime),
      ).toEqual({ ok: false, reason: 'invalid_response' });
      expect(store.get('int-claim')?.status).toBe('pending');
    });

    it('rejects extra response fields instead of silently accepting them', () => {
      const optionStore = makeStore();
      const textStore = makeStore({ message: 'Answer', freeText: true });

      expect(optionStore.claim(
        'int-claim',
        { type: 'option', optionIndex: 0, value: 'client-supplied' },
        claimTime,
      )).toEqual({ ok: false, reason: 'invalid_response' });
      expect(textStore.claim(
        'int-claim',
        { type: 'text', text: 'Allowed text', optionIndex: 0 },
        claimTime,
      )).toEqual({ ok: false, reason: 'invalid_response' });
    });

    it('accepts trimmed bounded text only when free text is allowed', () => {
      const store = makeStore({ message: 'Tell me more', freeText: true });

      const result = store.claim(
        'int-claim',
        { type: 'text', text: '  Use the later time  ' },
        claimTime,
      );

      expect(result).toMatchObject({
        ok: true,
        claim: {
          response: { type: 'text', value: 'Use the later time' },
        },
      });
    });

    it.each([
      { request: makeRequest(), text: 'answer' },
      { request: { message: 'Answer', freeText: true }, text: '   ' },
      {
        request: { message: 'Answer', freeText: true },
        text: 'a'.repeat(MAX_INTERACTION_RESPONSE_TEXT_LENGTH + 1),
      },
    ])('rejects disallowed or invalid text', ({ request, text }) => {
      const store = makeStore(request);

      expect(
        store.claim('int-claim', { type: 'text', text }, claimTime),
      ).toEqual({ ok: false, reason: 'invalid_response' });
      expect(store.get('int-claim')?.status).toBe('pending');
    });

    it('expires an overdue interaction during the claim attempt', () => {
      const store = makeStore();

      expect(
        store.claim(
          'int-claim',
          { type: 'option', optionIndex: 0 },
          validUntil,
        ),
      ).toEqual({ ok: false, reason: 'expired' });
      expect(store.get('int-claim')?.status).toBe('expired');
    });

    it('allows exactly one caller to claim a pending interaction', () => {
      const store = makeStore();

      expect(
        store.claim(
          'int-claim',
          { type: 'option', optionIndex: 0 },
          claimTime,
        ).ok,
      ).toBe(true);
      expect(
        store.claim(
          'int-claim',
          { type: 'option', optionIndex: 0 },
          claimTime,
        ),
      ).toEqual({ ok: false, reason: 'not_pending' });
    });

    it('returns not found without creating state', () => {
      const store = new InteractionStore(() => 'claim-token');

      expect(
        store.claim(
          'missing',
          { type: 'option', optionIndex: 0 },
          claimTime,
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
    });

    it('completes a claim only when its token matches', () => {
      const store = makeStore();
      store.claim(
        'int-claim',
        { type: 'option', optionIndex: 0 },
        claimTime,
      );

      expect(store.complete('int-claim', 'wrong-token')).toBe(false);
      expect(store.get('int-claim')?.status).toBe('processing');
      expect(store.complete('int-claim', 'claim-token')).toBe(true);
      expect(store.get('int-claim')?.status).toBe('acted');
      expect(store.complete('int-claim', 'claim-token')).toBe(false);
    });

    it('does not let the legacy acted path bypass a processing claim token', () => {
      const store = makeStore();
      store.claim(
        'int-claim',
        { type: 'option', optionIndex: 0 },
        claimTime,
      );

      store.markActed('int-claim');

      expect(store.get('int-claim')?.status).toBe('processing');
      expect(store.complete('int-claim', 'claim-token')).toBe(true);
    });

    it('restores a failed claim to pending while it remains valid', () => {
      const store = makeStore();
      store.claim(
        'int-claim',
        { type: 'option', optionIndex: 0 },
        claimTime,
      );

      expect(store.restore('int-claim', 'wrong-token', claimTime)).toBe(false);
      expect(store.restore('int-claim', 'claim-token', claimTime)).toBe(true);
      expect(store.get('int-claim')?.status).toBe('pending');
      expect(
        store.claim(
          'int-claim',
          { type: 'option', optionIndex: 0 },
          claimTime,
        ).ok,
      ).toBe(true);
    });

    it('expires a failed claim restored at its deadline', () => {
      const store = makeStore();
      store.claim(
        'int-claim',
        { type: 'option', optionIndex: 0 },
        claimTime,
      );

      expect(store.restore('int-claim', 'claim-token', validUntil)).toBe(true);
      expect(store.get('int-claim')?.status).toBe('expired');
    });
  });

  /**
   * A claimed interaction holds a second entry in the claim-token map, and
   * both routes that delete an interaction outright — capacity eviction and
   * the stale sweep — only ever knew about the first map. The token left
   * behind can never be redeemed, because a claim needs its interaction too,
   * so what this costs is memory on a daemon that runs for months rather than
   * authority. Nothing in the public API reports it, so these assert on the
   * map itself; the alternative is not covering a real leak at all.
   */
  describe('claim token lifetime', () => {
    function claimTokensOf(store: InteractionStore): Map<string, string> {
      return (store as unknown as { claimTokens: Map<string, string> }).claimTokens;
    }

    function addClaimed(store: InteractionStore, id: string, createdAt: Date): void {
      store.add({
        id,
        runId: `run-${id}`,
        agentId: 'checker',
        replyAgentId: 'booker',
        request: makeRequest(),
        channel: 'console',
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 60_000),
      });
      store.claim(id, { type: 'option', optionIndex: 0 }, createdAt);
    }

    it('drops the claim token of an interaction evicted for capacity', () => {
      const store = new InteractionStore(() => 'claim-token', 2);
      addClaimed(store, 'int-oldest', new Date('2026-08-13T10:00:00Z'));
      addClaimed(store, 'int-middle', new Date('2026-08-13T10:01:00Z'));
      expect(claimTokensOf(store).size).toBe(2);

      addClaimed(store, 'int-newest', new Date('2026-08-13T10:02:00Z'));

      expect(store.get('int-oldest')).toBeUndefined();
      expect([...claimTokensOf(store).keys()].sort()).toEqual(['int-middle', 'int-newest']);
    });

    it('drops the claim token of an interaction dropped by the stale sweep', () => {
      const store = new InteractionStore(() => 'claim-token');
      // Processing is not an active status, so the sweep deletes the entry once
      // it passes the stale retention window. An agent that never answers a
      // claim it took is exactly how an interaction reaches that state.
      addClaimed(store, 'int-abandoned', new Date(Date.now() - 25 * 60 * 60 * 1000));
      expect(claimTokensOf(store).size).toBe(1);

      store.expireStale();

      expect(store.get('int-abandoned')).toBeUndefined();
      expect(claimTokensOf(store).size).toBe(0);
    });

    it('keeps the claim token of an interaction the sweep leaves in place', () => {
      const store = new InteractionStore(() => 'claim-token');
      addClaimed(store, 'int-live', new Date());

      store.expireStale();

      expect(claimTokensOf(store).size).toBe(1);
      expect(store.complete('int-live', 'claim-token')).toBe(true);
    });
  });
});
