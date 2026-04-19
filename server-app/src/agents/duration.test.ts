import { describe, it, expect } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  const DEFAULT = 60_000;

  it('parses seconds', () => {
    expect(parseDuration('30s', DEFAULT)).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m', DEFAULT)).toBe(30 * 60_000);
  });

  it('parses hours', () => {
    expect(parseDuration('2h', DEFAULT)).toBe(2 * 60 * 60_000);
  });

  it('tolerates leading and trailing whitespace', () => {
    expect(parseDuration('  15m  ', DEFAULT)).toBe(15 * 60_000);
  });

  it('returns default for missing input', () => {
    expect(parseDuration(undefined, DEFAULT)).toBe(DEFAULT);
    expect(parseDuration('', DEFAULT)).toBe(DEFAULT);
  });

  it('returns default for unrecognized input', () => {
    expect(parseDuration('forever', DEFAULT)).toBe(DEFAULT);
    expect(parseDuration('5x', DEFAULT)).toBe(DEFAULT);
    expect(parseDuration('m', DEFAULT)).toBe(DEFAULT);
  });

  it('returns default for zero or negative values', () => {
    expect(parseDuration('0m', DEFAULT)).toBe(DEFAULT);
    expect(parseDuration('-5m', DEFAULT)).toBe(DEFAULT);
  });
});
