import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDistinctId } from './identity.js';

const SAMPLE_UUID = '11111111-2222-4333-8444-555555555555';

function createHome(): string {
  return mkdtempSync(join(tmpdir(), 'agent-server-analytics-'));
}

describe('analytics identity', () => {
  it('adopts the identifier the macOS app passes down', () => {
    const home = createHome();

    expect(resolveDistinctId({ inherited: SAMPLE_UUID, home })).toBe(SAMPLE_UUID);
  });

  it('ignores an inherited value that is not a UUID', () => {
    const home = createHome();

    const resolved = resolveDistinctId({ inherited: 'prashant@example.com', home });

    expect(resolved).not.toBe('prashant@example.com');
    expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('persists a generated identifier and reuses it on the next start', () => {
    const home = createHome();

    const first = resolveDistinctId({ home });
    const second = resolveDistinctId({ home });

    expect(first).toBe(second);
    expect(readFileSync(join(home, 'analytics-id'), 'utf8').trim()).toBe(first);
  });

  it('replaces a corrupted identity file rather than sending garbage', () => {
    const home = createHome();
    writeFileSync(join(home, 'analytics-id'), 'not-a-uuid\n');

    const resolved = resolveDistinctId({ home });

    expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolved).not.toBe('not-a-uuid');
  });
});
