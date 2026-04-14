import { describe, it, expect } from 'vitest';
import {
  formatDecisionMessage,
  parseDecisionCallback,
  formatResolvedMessage,
  shortenDecisionId,
  MAX_TELEGRAM_CALLBACK_BYTES,
} from './telegram-decision.js';
import type {
  ApproveDecision,
  PickDecision,
  AnswerDecision,
  ApproveResolution,
  PickResolution,
  AnswerResolution,
} from './telegram-decision.js';

function makeApprove(overrides: Partial<ApproveDecision> = {}): ApproveDecision {
  return {
    id: '11111111-2222-3333-4444-abcdef012345',
    task_run_id: 'run-1',
    agent_slug: 'finance-bot',
    title: 'Ship Acme Corp invoice for $12,400?',
    body: 'Contract terms match PO. 30-day terms. Nothing flagged by the finance rules.',
    type: 'approve',
    approve_label: 'Approve',
    decline_label: 'Decline',
    recommendation: 'approve',
    confidence: 0.94,
    created_at: '2026-04-14T23:15:00Z',
    ...overrides,
  };
}

function makePick(overrides: Partial<PickDecision> = {}): PickDecision {
  return {
    id: '22222222-3333-4444-5555-abcdef012345',
    task_run_id: 'run-2',
    agent_slug: 'finance-bot',
    title: 'Which PO should I match Acme invoice #A4291 to?',
    body: 'Three candidates matched on vendor + amount.',
    type: 'pick',
    options: [
      { id: 'po_0412', label: 'PO-2025-0412 · $12,400' },
      { id: 'po_0407', label: 'PO-2025-0407 · $12,400' },
      { id: 'po_0388', label: 'PO-2025-0388 · $12,400' },
    ],
    allow_none: true,
    recommended_option_id: 'po_0412',
    confidence: 0.78,
    created_at: '2026-04-14T23:15:00Z',
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<AnswerDecision> = {}): AnswerDecision {
  return {
    id: '33333333-4444-5555-6666-abcdef012345',
    task_run_id: 'run-3',
    agent_slug: 'exec-assistant',
    title: 'What reason should I log for skipping the Q2 review?',
    body: 'Board dinner runs over. I need a short note to leave in the project channel.',
    type: 'answer',
    prompt: 'Reason to log',
    placeholder: 'e.g. Schedule conflict',
    suggested_answer: 'Board dinner conflict, catching up with notes Thursday.',
    max_length: 200,
    created_at: '2026-04-14T23:15:00Z',
    ...overrides,
  };
}

describe('shortenDecisionId', () => {
  it('returns the last 12 characters of a UUID', () => {
    expect(shortenDecisionId('11111111-2222-3333-4444-abcdef012345')).toBe('abcdef012345');
  });

  it('is idempotent for short ids', () => {
    expect(shortenDecisionId('cdef012345')).toBe('cdef012345');
  });
});

describe('formatDecisionMessage — approve', () => {
  it('renders header, title, body, recommendation line', () => {
    const { text } = formatDecisionMessage(makeApprove());
    expect(text).toContain('DECISION');
    expect(text).toContain('finance-bot');
    expect(text).toContain('Ship Acme Corp invoice for $12,400?');
    expect(text).toContain('Contract terms match PO.');
    expect(text).toContain('Recommend: Approve');
    expect(text).toContain('94%');
  });

  it('omits recommendation line when not set', () => {
    const { text } = formatDecisionMessage(makeApprove({ recommendation: undefined, confidence: undefined }));
    expect(text).not.toContain('Recommend:');
  });

  it('renders approve + decline buttons on the same row', () => {
    const { reply_markup } = formatDecisionMessage(makeApprove());
    const rows = reply_markup.inline_keyboard;
    expect(rows[0]).toHaveLength(2);
    expect(rows[0][0].text).toBe('Approve');
    expect(rows[0][1].text).toBe('Decline');
  });

  it('marks recommended button with `rec` suffix in callback_data', () => {
    const { reply_markup } = formatDecisionMessage(makeApprove({ recommendation: 'approve' }));
    const rows = reply_markup.inline_keyboard;
    expect(rows[0][0].callback_data).toMatch(/:approve:rec$/);
    expect(rows[0][1].callback_data).toMatch(/:decline$/);
  });

  it('renders defer + open-in-panel system rows', () => {
    const { reply_markup } = formatDecisionMessage(makeApprove());
    const flat = reply_markup.inline_keyboard.flat();
    const texts = flat.map(b => b.text);
    expect(texts.some(t => t.includes('Defer 1h'))).toBe(true);
    expect(texts.some(t => t.includes('Defer tomorrow'))).toBe(true);
    expect(texts.some(t => t.includes('Open in Panel'))).toBe(true);
  });

  it('uses custom approve_label and decline_label', () => {
    const { reply_markup } = formatDecisionMessage(
      makeApprove({ approve_label: 'Apply credit', decline_label: 'Skip' }),
    );
    const rows = reply_markup.inline_keyboard;
    expect(rows[0][0].text).toBe('Apply credit');
    expect(rows[0][1].text).toBe('Skip');
  });

  it('truncates long title gracefully', () => {
    const longTitle = 'A'.repeat(500);
    const { text } = formatDecisionMessage(makeApprove({ title: longTitle }));
    expect(text.length).toBeLessThan(3000);
    expect(text).toContain('AAA');
  });

  it('places Open in Panel URL for deep link', () => {
    const { reply_markup } = formatDecisionMessage(makeApprove(), {
      panelUrl: 'https://panel.example.com',
    });
    const flat = reply_markup.inline_keyboard.flat();
    const openBtn = flat.find(b => b.text.includes('Open in Panel'));
    expect(openBtn?.url).toBe(
      'https://panel.example.com/decisions/11111111-2222-3333-4444-abcdef012345',
    );
  });
});

describe('formatDecisionMessage — pick', () => {
  it('renders one button per option', () => {
    const { reply_markup } = formatDecisionMessage(makePick());
    const flat = reply_markup.inline_keyboard.flat();
    const labels = flat.map(b => b.text);
    expect(labels).toContain('PO-2025-0412 · $12,400');
    expect(labels).toContain('PO-2025-0407 · $12,400');
    expect(labels).toContain('PO-2025-0388 · $12,400');
  });

  it('encodes option ordinal (not id) in callback_data', () => {
    const { reply_markup } = formatDecisionMessage(makePick());
    const flat = reply_markup.inline_keyboard.flat();
    const firstOptBtn = flat.find(b => b.text === 'PO-2025-0412 · $12,400');
    expect(firstOptBtn?.callback_data).toMatch(/:pick:0$/);
    const secondOptBtn = flat.find(b => b.text === 'PO-2025-0407 · $12,400');
    expect(secondOptBtn?.callback_data).toMatch(/:pick:1$/);
  });

  it('appends None of these when allow_none is true', () => {
    const { reply_markup } = formatDecisionMessage(makePick({ allow_none: true }));
    const flat = reply_markup.inline_keyboard.flat();
    const noneBtn = flat.find(b => b.text.toLowerCase().includes('none'));
    expect(noneBtn).toBeDefined();
    expect(noneBtn?.callback_data).toMatch(/:pick:none$/);
  });

  it('omits None of these when allow_none is false', () => {
    const { reply_markup } = formatDecisionMessage(makePick({ allow_none: false }));
    const flat = reply_markup.inline_keyboard.flat();
    expect(flat.find(b => b.text.toLowerCase().includes('none'))).toBeUndefined();
  });

  it('renders defer + open in panel system row', () => {
    const { reply_markup } = formatDecisionMessage(makePick());
    const flat = reply_markup.inline_keyboard.flat();
    expect(flat.find(b => b.text.includes('Open in Panel'))).toBeDefined();
    expect(flat.find(b => b.text.includes('Defer 1h'))).toBeDefined();
  });
});

describe('formatDecisionMessage — answer', () => {
  it('renders Use suggested + Type different when suggested_answer set', () => {
    const { reply_markup } = formatDecisionMessage(makeAnswer());
    const flat = reply_markup.inline_keyboard.flat();
    const useBtn = flat.find(b => b.text.includes('Use'));
    const typeBtn = flat.find(b => b.text.includes('Type'));
    expect(useBtn).toBeDefined();
    expect(typeBtn).toBeDefined();
    expect(useBtn?.callback_data).toMatch(/:answer:s$/);
    expect(typeBtn?.callback_data).toMatch(/:answer:r$/);
  });

  it('renders only Type an answer button when no suggested_answer', () => {
    const { reply_markup } = formatDecisionMessage(makeAnswer({ suggested_answer: undefined }));
    const flat = reply_markup.inline_keyboard.flat();
    expect(flat.find(b => b.text.includes('Use'))).toBeUndefined();
    const typeBtn = flat.find(b => b.text.includes('Type'));
    expect(typeBtn).toBeDefined();
    expect(typeBtn?.callback_data).toMatch(/:answer:r$/);
  });

  it('renders body text', () => {
    const { text } = formatDecisionMessage(makeAnswer());
    expect(text).toContain('Board dinner runs over');
  });

  it('renders suggested answer preview in text', () => {
    const { text } = formatDecisionMessage(makeAnswer());
    expect(text).toContain('Board dinner conflict');
  });
});

describe('callback_data size guard', () => {
  function bytes(s: string): number {
    return new TextEncoder().encode(s).length;
  }

  it('keeps all approve callbacks under 64 bytes', () => {
    const { reply_markup } = formatDecisionMessage(makeApprove());
    for (const row of reply_markup.inline_keyboard) {
      for (const btn of row) {
        if (btn.callback_data) {
          expect(bytes(btn.callback_data)).toBeLessThanOrEqual(MAX_TELEGRAM_CALLBACK_BYTES);
        }
      }
    }
  });

  it('keeps all pick callbacks under 64 bytes even with 8 options', () => {
    const eightOpts = Array.from({ length: 8 }, (_, i) => ({
      id: `opt_${i}`,
      label: `Option ${i}`,
    }));
    const { reply_markup } = formatDecisionMessage(makePick({ options: eightOpts }));
    for (const row of reply_markup.inline_keyboard) {
      for (const btn of row) {
        if (btn.callback_data) {
          expect(bytes(btn.callback_data)).toBeLessThanOrEqual(MAX_TELEGRAM_CALLBACK_BYTES);
        }
      }
    }
  });

  it('keeps all answer callbacks under 64 bytes', () => {
    const { reply_markup } = formatDecisionMessage(makeAnswer());
    for (const row of reply_markup.inline_keyboard) {
      for (const btn of row) {
        if (btn.callback_data) {
          expect(bytes(btn.callback_data)).toBeLessThanOrEqual(MAX_TELEGRAM_CALLBACK_BYTES);
        }
      }
    }
  });
});

describe('parseDecisionCallback', () => {
  it('parses an approve callback', () => {
    const parsed = parseDecisionCallback('dec:abc123def456:approve');
    expect(parsed).toEqual({ shortId: 'abc123def456', action: 'approve' });
  });

  it('parses an approve:rec callback (strips rec suffix)', () => {
    const parsed = parseDecisionCallback('dec:abc123def456:approve:rec');
    expect(parsed).toEqual({ shortId: 'abc123def456', action: 'approve' });
  });

  it('parses a decline callback', () => {
    const parsed = parseDecisionCallback('dec:abc123def456:decline');
    expect(parsed).toEqual({ shortId: 'abc123def456', action: 'decline' });
  });

  it('parses a pick callback with ordinal', () => {
    const parsed = parseDecisionCallback('dec:abc123def456:pick:2');
    expect(parsed).toEqual({ shortId: 'abc123def456', action: 'pick', ordinal: 2 });
  });

  it('parses a pick:none callback', () => {
    const parsed = parseDecisionCallback('dec:abc123def456:pick:none');
    expect(parsed).toEqual({ shortId: 'abc123def456', action: 'pick', ordinal: null });
  });

  it('parses answer suggested and reply callbacks', () => {
    expect(parseDecisionCallback('dec:abc123def456:answer:s')).toEqual({
      shortId: 'abc123def456',
      action: 'answer_suggested',
    });
    expect(parseDecisionCallback('dec:abc123def456:answer:r')).toEqual({
      shortId: 'abc123def456',
      action: 'answer_reply',
    });
  });

  it('parses defer callbacks', () => {
    expect(parseDecisionCallback('dec:abc123def456:defer:1h')).toEqual({
      shortId: 'abc123def456',
      action: 'defer',
      duration: '1h',
    });
    expect(parseDecisionCallback('dec:abc123def456:defer:tomorrow')).toEqual({
      shortId: 'abc123def456',
      action: 'defer',
      duration: 'tomorrow',
    });
  });

  it('returns undefined for unrelated data', () => {
    expect(parseDecisionCallback('not-a-decision')).toBeUndefined();
    expect(parseDecisionCallback('')).toBeUndefined();
    expect(parseDecisionCallback('dec:')).toBeUndefined();
  });
});

describe('formatResolvedMessage', () => {
  it('formats an approve resolution', () => {
    const decision = makeApprove();
    const resolution: ApproveResolution = { type: 'approve', approved: true };
    const text = formatResolvedMessage(decision, resolution, { source: 'telegram' });
    expect(text).toContain('Resolved');
    expect(text).toContain('Telegram');
    expect(text).toContain('Approve');
  });

  it('formats a decline resolution with custom label', () => {
    const decision = makeApprove({ decline_label: 'Skip' });
    const text = formatResolvedMessage(decision, { type: 'approve', approved: false }, { source: 'telegram' });
    expect(text).toContain('Skip');
  });

  it('formats a pick resolution with option label', () => {
    const decision = makePick();
    const resolution: PickResolution = { type: 'pick', option_id: 'po_0412' };
    const text = formatResolvedMessage(decision, resolution, { source: 'telegram' });
    expect(text).toContain('PO-2025-0412');
  });

  it('formats a pick none resolution', () => {
    const decision = makePick();
    const resolution: PickResolution = { type: 'pick', option_id: null };
    const text = formatResolvedMessage(decision, resolution, { source: 'telegram' });
    expect(text.toLowerCase()).toContain('none');
  });

  it('formats an answer resolution', () => {
    const decision = makeAnswer();
    const resolution: AnswerResolution = { type: 'answer', text: 'Sure, thanks' };
    const text = formatResolvedMessage(decision, resolution, { source: 'web' });
    expect(text).toContain('Sure, thanks');
  });

  it('names the external source when not telegram', () => {
    const decision = makeApprove();
    const text = formatResolvedMessage(
      decision,
      { type: 'approve', approved: true },
      { source: 'web' },
    );
    expect(text.toLowerCase()).toContain('web');
  });
});
