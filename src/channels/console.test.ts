import { describe, it, expect, vi } from 'vitest';
import { formatInteraction, resolveSelection } from './console.js';
import type { InteractionRequest } from '../interaction/schema.js';

const optionsRequest: InteractionRequest = {
  message: 'Found 3 slots at Bougainville',
  options: [
    { label: '19:00', value: 'Book 19:00' },
    { label: '20:30', value: 'Book 20:30' },
    { label: '21:00', value: 'Book 21:00' },
  ],
  freeText: false,
};

const freeTextRequest: InteractionRequest = {
  message: 'What is your budget?',
  freeText: true,
};

const mixedRequest: InteractionRequest = {
  message: 'Pick a slot or type a preference',
  options: [
    { label: '19:00', value: 'Book 19:00' },
    { label: '20:30', value: 'Book 20:30' },
  ],
  freeText: true,
};

describe('formatInteraction', () => {
  it('formats options as a numbered list', () => {
    const output = formatInteraction(optionsRequest);
    expect(output).toContain('Found 3 slots at Bougainville');
    expect(output).toContain('1) 19:00');
    expect(output).toContain('2) 20:30');
    expect(output).toContain('3) 21:00');
  });

  it('formats free-text request without options', () => {
    const output = formatInteraction(freeTextRequest);
    expect(output).toContain('What is your budget?');
    expect(output).not.toContain('1)');
  });

  it('includes description when present', () => {
    const request: InteractionRequest = {
      message: 'Pick one',
      options: [
        { label: '19:00', value: 'val', description: 'Earliest slot' },
      ],
      freeText: false,
    };
    const output = formatInteraction(request);
    expect(output).toContain('Earliest slot');
  });
});

describe('resolveSelection', () => {
  it('resolves a numeric selection to the option value', () => {
    const result = resolveSelection('1', optionsRequest);
    expect(result).toEqual({ selectedValue: 'Book 19:00' });
  });

  it('resolves the last option by number', () => {
    const result = resolveSelection('3', optionsRequest);
    expect(result).toEqual({ selectedValue: 'Book 21:00' });
  });

  it('returns free text when input is not a valid option number', () => {
    const result = resolveSelection('something else', mixedRequest);
    expect(result).toEqual({ freeText: 'something else' });
  });

  it('returns free text for a free-text-only request', () => {
    const result = resolveSelection('500 dollars', freeTextRequest);
    expect(result).toEqual({ freeText: '500 dollars' });
  });

  it('returns undefined for invalid number when freeText is disabled', () => {
    const result = resolveSelection('99', optionsRequest);
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-numeric input when freeText is disabled', () => {
    const result = resolveSelection('abc', optionsRequest);
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    const result = resolveSelection('', optionsRequest);
    expect(result).toBeUndefined();
  });
});
