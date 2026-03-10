import { describe, it, expect, vi } from 'vitest';
import {
  buildInlineKeyboard,
  formatTelegramMessage,
  parseCallbackData,
  encodeCallbackData,
  TelegramChannel,
} from './telegram.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { ChannelReply } from './channel.js';

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
    { label: '19:00', value: 'Book 19:00', description: 'Earliest slot' },
    { label: '20:30', value: 'Book 20:30' },
  ],
  freeText: true,
};

describe('formatTelegramMessage', () => {
  it('returns the message text for options-only requests', () => {
    const text = formatTelegramMessage(optionsRequest);
    expect(text).toBe('Found 3 slots at Bougainville');
  });

  it('appends free-text hint when freeText is true with options', () => {
    const text = formatTelegramMessage(mixedRequest);
    expect(text).toContain('Pick a slot or type a preference');
    expect(text).toContain('or type a reply');
  });

  it('returns plain message for free-text-only requests', () => {
    const text = formatTelegramMessage(freeTextRequest);
    expect(text).toBe('What is your budget?');
  });

  it('includes option descriptions when present', () => {
    const text = formatTelegramMessage(mixedRequest);
    expect(text).toContain('Earliest slot');
  });
});

describe('buildInlineKeyboard', () => {
  it('creates one button per option', () => {
    const keyboard = buildInlineKeyboard('int-1', optionsRequest);
    const rows = keyboard.inline_keyboard;
    expect(rows).toHaveLength(3);
    expect(rows[0][0].text).toBe('19:00');
    expect(rows[1][0].text).toBe('20:30');
    expect(rows[2][0].text).toBe('21:00');
  });

  it('encodes interaction ID and option index in callback data', () => {
    const keyboard = buildInlineKeyboard('int-1', optionsRequest);
    const data = keyboard.inline_keyboard[0][0].callback_data;
    expect(data).toBeDefined();
    const parsed = parseCallbackData(data!);
    expect(parsed).toEqual({ interactionId: 'int-1', optionIndex: 0 });
  });

  it('returns undefined when no options', () => {
    const keyboard = buildInlineKeyboard('int-1', freeTextRequest);
    expect(keyboard).toBeUndefined();
  });
});

describe('TelegramChannel', () => {
  function makeChannel(): {
    channel: TelegramChannel;
    mockApi: {
      sendMessage: ReturnType<typeof vi.fn>;
      answerCallbackQuery: ReturnType<typeof vi.fn>;
    };
  } {
    const mockApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    };
    const channel = new TelegramChannel({ api: mockApi, chatId: 12345 });
    return { channel, mockApi };
  }

  it('sends a message with inline keyboard for option requests', async () => {
    const { channel, mockApi } = makeChannel();
    await channel.send('int-1', optionsRequest);

    expect(mockApi.sendMessage).toHaveBeenCalledOnce();
    const [chatId, text, options] = mockApi.sendMessage.mock.calls[0];
    expect(chatId).toBe(12345);
    expect(text).toBe('Found 3 slots at Bougainville');
    expect(options.reply_markup).toBeDefined();
    expect(options.reply_markup.inline_keyboard).toHaveLength(3);
  });

  it('sends a plain message for free-text-only requests', async () => {
    const { channel, mockApi } = makeChannel();
    await channel.send('int-1', freeTextRequest);

    expect(mockApi.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = mockApi.sendMessage.mock.calls[0];
    expect(options).toBeUndefined();
  });

  it('tracks pending interactions for callback resolution', async () => {
    const { channel } = makeChannel();
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));

    await channel.send('int-1', optionsRequest);

    channel.handleCallbackQuery('int-1', 1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({
      interactionId: 'int-1',
      selectedValue: 'Book 20:30',
    });
  });

  it('tracks pending interactions for free-text resolution', async () => {
    const { channel } = makeChannel();
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));

    await channel.send('int-2', mixedRequest);

    channel.handleTextReply('int-2', 'custom preference');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({
      interactionId: 'int-2',
      freeText: 'custom preference',
    });
  });

  it('ignores callback for unknown interaction', () => {
    const { channel } = makeChannel();
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));

    channel.handleCallbackQuery('nonexistent', 0);
    expect(replies).toHaveLength(0);
  });

  it('ignores text reply for unknown interaction', () => {
    const { channel } = makeChannel();
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));

    channel.handleTextReply('nonexistent', 'hello');
    expect(replies).toHaveLength(0);
  });

  it('does not resolve same interaction twice', async () => {
    const { channel } = makeChannel();
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));

    await channel.send('int-1', optionsRequest);
    channel.handleCallbackQuery('int-1', 0);
    channel.handleCallbackQuery('int-1', 1);
    expect(replies).toHaveLength(1);
  });

  it('sends notification as a plain message', async () => {
    const { channel, mockApi } = makeChannel();
    await channel.notify('Agent completed: wrote 3 files');

    expect(mockApi.sendMessage).toHaveBeenCalledOnce();
    const [chatId, text, options] = mockApi.sendMessage.mock.calls[0];
    expect(chatId).toBe(12345);
    expect(text).toBe('Agent completed: wrote 3 files');
    expect(options).toBeUndefined();
  });

  it('skips notification when no chat ID is configured', async () => {
    const mockApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    };
    const channel = new TelegramChannel({ api: mockApi });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await channel.notify('Hello');
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('chat ID'));
    spy.mockRestore();
  });

  it('logs warning when no chat ID is configured', async () => {
    const mockApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    };
    const channel = new TelegramChannel({ api: mockApi });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await channel.send('int-1', optionsRequest);
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('chat ID'));
    spy.mockRestore();
  });
});

describe('TelegramChannel onMessage', () => {
  function makeChannel(): {
    channel: TelegramChannel;
    mockApi: {
      sendMessage: ReturnType<typeof vi.fn>;
      answerCallbackQuery: ReturnType<typeof vi.fn>;
    };
  } {
    const mockApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    };
    const channel = new TelegramChannel({ api: mockApi, chatId: 12345 });
    return { channel, mockApi };
  }

  it('calls registered message callbacks when handleIncomingMessage is called', () => {
    const { channel } = makeChannel();
    const messages: string[] = [];
    channel.onMessage((text) => messages.push(text));

    channel.handleIncomingMessage('Check Bougainville tonight');
    expect(messages).toEqual(['Check Bougainville tonight']);
  });

  it('does not call message callbacks when a pending interaction exists', async () => {
    const { channel } = makeChannel();
    const messages: string[] = [];
    channel.onMessage((text) => messages.push(text));

    const request: InteractionRequest = {
      message: 'Pick a slot',
      options: [{ label: '19:00', value: 'Book 19:00' }],
      freeText: false,
    };
    await channel.send('int-1', request);

    channel.handleIncomingMessage('hello');
    expect(messages).toHaveLength(0);
  });

  it('supports multiple message callbacks', () => {
    const { channel } = makeChannel();
    const first: string[] = [];
    const second: string[] = [];
    channel.onMessage((text) => first.push(text));
    channel.onMessage((text) => second.push(text));

    channel.handleIncomingMessage('test');
    expect(first).toEqual(['test']);
    expect(second).toEqual(['test']);
  });
});

describe('encodeCallbackData / parseCallbackData', () => {
  it('round-trips interaction ID and option index', () => {
    const encoded = encodeCallbackData('abc-123', 2);
    const decoded = parseCallbackData(encoded);
    expect(decoded).toEqual({ interactionId: 'abc-123', optionIndex: 2 });
  });

  it('returns undefined for malformed data', () => {
    expect(parseCallbackData('garbage')).toBeUndefined();
    expect(parseCallbackData('')).toBeUndefined();
  });

  it('handles interaction IDs with colons', () => {
    const encoded = encodeCallbackData('a:b:c', 0);
    const decoded = parseCallbackData(encoded);
    expect(decoded).toEqual({ interactionId: 'a:b:c', optionIndex: 0 });
  });
});
