import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './server.js';

describe('server security utilities', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
  });
});
