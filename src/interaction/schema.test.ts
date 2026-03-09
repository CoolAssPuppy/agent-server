import { describe, it, expect } from 'vitest';
import {
  InteractionRequestSchema,
  InteractionConfigSchema,
  NotificationConfigSchema,
  type InteractionRequest,
  type InteractionConfig,
  type NotificationConfig,
} from './schema.js';

describe('InteractionRequestSchema', () => {
  it('validates a request with options', () => {
    const result = InteractionRequestSchema.safeParse({
      message: 'Found 3 slots',
      options: [
        { label: '19:00', value: 'Book 19:00' },
        { label: '20:30', value: 'Book 20:30' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates a request with free-text only', () => {
    const result = InteractionRequestSchema.safeParse({
      message: 'What is your budget?',
      freeText: true,
    });
    expect(result.success).toBe(true);
  });

  it('defaults freeText to false when options are present', () => {
    const request = InteractionRequestSchema.parse({
      message: 'Pick one',
      options: [{ label: 'A', value: 'a' }],
    });
    expect(request.freeText).toBe(false);
  });

  it('includes optional description on options', () => {
    const request = InteractionRequestSchema.parse({
      message: 'Pick a slot',
      options: [
        { label: '19:00', value: 'Book 19:00', description: 'Earliest available' },
      ],
    });
    expect(request.options![0].description).toBe('Earliest available');
  });

  it('rejects empty message', () => {
    const result = InteractionRequestSchema.safeParse({
      message: '',
      options: [{ label: 'A', value: 'a' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects options with empty label', () => {
    const result = InteractionRequestSchema.safeParse({
      message: 'Pick one',
      options: [{ label: '', value: 'a' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects options with empty value', () => {
    const result = InteractionRequestSchema.safeParse({
      message: 'Pick one',
      options: [{ label: 'A', value: '' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('InteractionConfigSchema', () => {
  it('validates a full interaction config', () => {
    const result = InteractionConfigSchema.safeParse({
      channel: 'telegram',
      on_reply: 'restaurant-booker',
      timeout: '1h',
    });
    expect(result.success).toBe(true);
  });

  it('defaults timeout to 30m', () => {
    const config = InteractionConfigSchema.parse({
      channel: 'telegram',
      on_reply: 'restaurant-booker',
    });
    expect(config.timeout).toBe('30m');
  });

  it('rejects missing channel', () => {
    const result = InteractionConfigSchema.safeParse({
      on_reply: 'restaurant-booker',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing on_reply', () => {
    const result = InteractionConfigSchema.safeParse({
      channel: 'telegram',
    });
    expect(result.success).toBe(false);
  });
});

describe('NotificationConfigSchema', () => {
  it('validates a notification config with channel only', () => {
    const config = NotificationConfigSchema.parse({
      channel: 'telegram',
    });
    expect(config.channel).toBe('telegram');
  });

  it('defaults on_complete and on_failure to true', () => {
    const config = NotificationConfigSchema.parse({
      channel: 'telegram',
    });
    expect(config.on_complete).toBe(true);
    expect(config.on_failure).toBe(true);
  });

  it('allows disabling completion notifications', () => {
    const config = NotificationConfigSchema.parse({
      channel: 'telegram',
      on_complete: false,
    });
    expect(config.on_complete).toBe(false);
    expect(config.on_failure).toBe(true);
  });

  it('rejects missing channel', () => {
    const result = NotificationConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
