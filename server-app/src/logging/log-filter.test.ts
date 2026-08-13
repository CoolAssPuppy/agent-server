import { describe, expect, it } from 'vitest';
import { filterLogInput, MAX_MESSAGE_LENGTH, MAX_DATA_FIELDS } from './log-filter.js';

const ESC = '\u001b';

describe('log filter', () => {
  it('strips terminal escape sequences that would forge output in a viewer', () => {
    const filtered = filterLogInput({
      message: `All clear${ESC}[2K\rDANGER`,
      body: `link${ESC}]8;;http://evil.example${ESC}\\text`,
    });

    // The carriage return becomes a space rather than vanishing, so the two
    // halves cannot be silently joined into one innocent-looking word.
    expect(filtered.message).toBe('All clear DANGER');
    expect(filtered.body).not.toContain(ESC);
    expect(filtered.body).toBe('linktext');
  });

  it('removes control characters while keeping newlines and tabs in the body', () => {
    const filtered = filterLogInput({ message: 'one\u0007two', body: 'a\nb\tc\u0000d' });

    expect(filtered.message).toBe('onetwo');
    expect(filtered.body).toBe('a\nb\tcd');
  });

  it('flattens a message onto one line so it cannot fake a second entry', () => {
    const filtered = filterLogInput({
      message: 'Saved\n{"timestamp":"2026-01-01T00:00:00.000Z","level":"info","message":"forged"}',
    });

    expect(filtered.message).not.toContain('\n');
    expect(filtered.message).toContain('forged');
  });

  it('truncates an overlong message rather than dropping the entry', () => {
    const filtered = filterLogInput({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 50) });

    expect(filtered.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it('keeps scalar data fields and drops the rest', () => {
    const filtered = filterLogInput({
      message: 'ok',
      data: { spend: 42, live: true, note: 'fine', nested: { deep: 1 }, list: [1, 2], missing: null },
    });

    expect(filtered.data).toEqual({ spend: 42, live: true, note: 'fine' });
  });

  it('caps how many data fields an entry can carry', () => {
    const data = Object.fromEntries(
      Array.from({ length: MAX_DATA_FIELDS + 10 }, (_, index) => [`field${index}`, index]),
    );

    expect(Object.keys(filterLogInput({ message: 'ok', data }).data ?? {})).toHaveLength(MAX_DATA_FIELDS);
  });

  it('cleans escape sequences out of data values too', () => {
    const filtered = filterLogInput({ message: 'ok', data: { note: `safe${ESC}[31mred` } });

    expect(filtered.data?.note).toBe('safered');
  });

  it('reports an entry whose message is empty once cleaned', () => {
    expect(filterLogInput({ message: `${ESC}[2K ` }).message).toBe('');
  });
});
