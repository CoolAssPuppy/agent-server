import { describe, expect, it } from 'vitest';
import { isLoopbackHost, validateNetworkExposure } from './server.js';

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

  it('rejects non-loopback binding without an API key', () => {
    expect(() => validateNetworkExposure('0.0.0.0')).toThrow(
      'Refusing to bind to a non-loopback host without AGENT_SERVER_API_KEY',
    );
  });

  it('accepts non-loopback binding when a strong API key is configured', () => {
    expect(() => validateNetworkExposure('0.0.0.0', '1234567890abcdef')).not.toThrow();
  });

  it('accepts loopback binding without an API key', () => {
    expect(() => validateNetworkExposure('127.0.0.1')).not.toThrow();
  });

  it('rejects weak API keys even when binding to loopback', () => {
    expect(() => validateNetworkExposure('127.0.0.1', 'short-key')).toThrow(
      'AGENT_SERVER_API_KEY must be at least 16 characters long',
    );
  });
});
