import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { classifyErrorReason } from './reason.js';

describe('error reason classification', () => {
  it('prefers the system error code', () => {
    const error = Object.assign(new Error('EACCES: permission denied, open /Users/sam/secret'), {
      code: 'EACCES',
    });

    expect(classifyErrorReason(error)).toBe('eacces');
  });

  it('falls back to the error class when there is no code', () => {
    const error = z.object({ id: z.string() }).safeParse({}).error;

    expect(classifyErrorReason(error)).toBe('zoderror');
  });

  it('never leaks the message of a plain error', () => {
    expect(classifyErrorReason(new Error('failed to run agent daily-standup'))).toBe('error');
  });

  it('handles values that are not errors at all', () => {
    expect(classifyErrorReason('boom')).toBe('unknown');
    expect(classifyErrorReason(undefined)).toBe('unknown');
  });
});
