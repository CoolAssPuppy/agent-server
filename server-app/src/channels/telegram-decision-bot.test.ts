import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TelegramDecisionBot } from './telegram-decision-bot.js';
import type { Decision } from './telegram-decision.js';

function makeApprove(id = '11111111-2222-3333-4444-abcdef012345'): Decision {
  return {
    id,
    task_run_id: 'run-1',
    agent_slug: 'finance-bot',
    title: 'Ship invoice for $12,400?',
    body: 'Contract terms match PO.',
    type: 'approve',
    recommendation: 'approve',
    created_at: '2026-04-14T23:15:00Z',
  };
}

function makeAnswer(id = '33333333-4444-5555-6666-abcdef012345'): Decision {
  return {
    id,
    task_run_id: 'run-3',
    agent_slug: 'exec',
    title: 'What reason should I log?',
    prompt: 'Reason',
    placeholder: 'e.g. Conflict',
    suggested_answer: 'Board dinner conflict',
    type: 'answer',
    created_at: '2026-04-14T23:15:00Z',
  };
}

function makePick(id = '22222222-3333-4444-5555-abcdef012345'): Decision {
  return {
    id,
    task_run_id: 'run-2',
    agent_slug: 'finance',
    title: 'Which PO?',
    type: 'pick',
    options: [
      { id: 'po_0412', label: 'PO-2025-0412' },
      { id: 'po_0407', label: 'PO-2025-0407' },
    ],
    allow_none: true,
    created_at: '2026-04-14T23:15:00Z',
  };
}

describe('TelegramDecisionBot', () => {
  let tempDir: string;
  let storagePath: string;
  let sendMessage: ReturnType<typeof vi.fn>;
  let editMessageText: ReturnType<typeof vi.fn>;
  let editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tg-dec-'));
    storagePath = join(tempDir, 'telegram-messages.jsonl');
    sendMessage = vi.fn().mockResolvedValue({ message_id: 99 });
    editMessageText = vi.fn().mockResolvedValue(true);
    editMessageReplyMarkup = vi.fn().mockResolvedValue(true);
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeBot(): TelegramDecisionBot {
    return new TelegramDecisionBot({
      api: {
        sendMessage,
        editMessageText,
        editMessageReplyMarkup,
      },
      chatId: 12345,
      panelUrl: 'https://panel.example.com',
      apiKey: 'ap_live_test_key',
      storagePath,
      fetchFn: fetchMock,
    });
  }

  describe('postDecision', () => {
    it('sends a message with formatted text and keyboard to the configured chat', async () => {
      const bot = makeBot();
      await bot.postDecision(makeApprove());

      expect(sendMessage).toHaveBeenCalledOnce();
      const [chatId, text, opts] = sendMessage.mock.calls[0];
      expect(chatId).toBe(12345);
      expect(text).toContain('DECISION');
      expect(text).toContain('Ship invoice');
      expect(opts.reply_markup.inline_keyboard).toBeDefined();
    });

    it('persists the message mapping to storage', async () => {
      const bot = makeBot();
      const decision = makeApprove();
      await bot.postDecision(decision);

      expect(existsSync(storagePath)).toBe(true);
      const lines = readFileSync(storagePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.decision_id).toBe(decision.id);
      expect(parsed.chat_id).toBe(12345);
      expect(parsed.message_id).toBe(99);
    });

    it('persists option ordinal map for pick decisions', async () => {
      const bot = makeBot();
      const decision = makePick();
      await bot.postDecision(decision);

      const parsed = JSON.parse(readFileSync(storagePath, 'utf-8').trim());
      expect(parsed.option_ordinal_map).toEqual(['po_0412', 'po_0407']);
    });

    it('does nothing when no chat id is configured', async () => {
      const bot = new TelegramDecisionBot({
        api: { sendMessage, editMessageText, editMessageReplyMarkup },
        chatId: undefined,
        panelUrl: 'https://panel.example.com',
        apiKey: 'ap_live_test_key',
        storagePath,
        fetchFn: fetchMock,
      });

      await bot.postDecision(makeApprove());
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('callback handling', () => {
    it('posts an approve resolution to the panel when approve button is tapped', async () => {
      const bot = makeBot();
      const decision = makeApprove();
      await bot.postDecision(decision);

      await bot.handleCallback('dec:abcdef012345:approve:rec');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://panel.example.com/api/decisions/11111111-2222-3333-4444-abcdef012345/resolve');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer ap_live_test_key');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ type: 'approve', approved: true });
    });

    it('posts a decline resolution', async () => {
      const bot = makeBot();
      await bot.postDecision(makeApprove());

      await bot.handleCallback('dec:abcdef012345:decline');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ type: 'approve', approved: false });
    });

    it('resolves a pick by looking up option id from stored ordinal map', async () => {
      const bot = makeBot();
      await bot.postDecision(makePick());

      await bot.handleCallback('dec:abcdef012345:pick:1');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ type: 'pick', option_id: 'po_0407' });
    });

    it('resolves a pick:none to option_id null', async () => {
      const bot = makeBot();
      await bot.postDecision(makePick());

      await bot.handleCallback('dec:abcdef012345:pick:none');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ type: 'pick', option_id: null });
    });

    it('resolves answer_suggested with the suggested_answer text', async () => {
      const bot = makeBot();
      await bot.postDecision(makeAnswer());

      await bot.handleCallback('dec:abcdef012345:answer:s');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ type: 'answer', text: 'Board dinner conflict' });
    });

    it('on answer_reply, does NOT resolve but returns a ForceReply marker', async () => {
      const bot = makeBot();
      await bot.postDecision(makeAnswer());

      const result = await bot.handleCallback('dec:abcdef012345:answer:r');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result?.forceReply).toBe(true);
      expect(result?.placeholder).toContain('Conflict');
    });

    it('on subsequent text message after answer_reply, resolves with the user text', async () => {
      const bot = makeBot();
      await bot.postDecision(makeAnswer());
      await bot.handleCallback('dec:abcdef012345:answer:r');

      await bot.handleTextMessage({ chatId: 12345, text: 'Because dinner ran late' });

      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ type: 'answer', text: 'Because dinner ran late' });
    });

    it('posts a defer resolution for defer:1h', async () => {
      const bot = makeBot();
      await bot.postDecision(makeApprove());

      await bot.handleCallback('dec:abcdef012345:defer:1h');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe('defer');
      expect(typeof body.defer_until).toBe('string');
    });

    it('edits the original message on successful resolve', async () => {
      const bot = makeBot();
      await bot.postDecision(makeApprove());

      await bot.handleCallback('dec:abcdef012345:approve');

      expect(editMessageText).toHaveBeenCalledOnce();
      const [chatId, messageId, , text] = editMessageText.mock.calls[0];
      expect(chatId).toBe(12345);
      expect(messageId).toBe(99);
      expect(text).toContain('Resolved');
    });

    it('does nothing when short id does not match any tracked decision', async () => {
      const bot = makeBot();
      await bot.handleCallback('dec:unknown000000:approve');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('external resolution', () => {
    it('edits the original message when an external decision_resolved event arrives', async () => {
      const bot = makeBot();
      const decision = makeApprove();
      await bot.postDecision(decision);

      await bot.onExternalResolution({
        decision_id: decision.id,
        resolution: { type: 'approve', approved: true },
        source: 'web',
      });

      expect(editMessageText).toHaveBeenCalledOnce();
      const [chatId, messageId, , text] = editMessageText.mock.calls[0];
      expect(chatId).toBe(12345);
      expect(messageId).toBe(99);
      expect(text).toContain('Resolved');
      expect(text.toLowerCase()).toContain('web');
    });

    it('ignores external events for unknown decisions', async () => {
      const bot = makeBot();
      await bot.onExternalResolution({
        decision_id: 'some-unknown-id',
        resolution: { type: 'approve', approved: true },
        source: 'web',
      });
      expect(editMessageText).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('reloads state from storage on construction', async () => {
      const bot1 = makeBot();
      const decision = makeApprove();
      await bot1.postDecision(decision);

      const bot2 = new TelegramDecisionBot({
        api: { sendMessage, editMessageText, editMessageReplyMarkup },
        chatId: 12345,
        panelUrl: 'https://panel.example.com',
        apiKey: 'ap_live_test_key',
        storagePath,
        fetchFn: fetchMock,
      });

      await bot2.handleCallback('dec:abcdef012345:approve');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain(decision.id);
    });
  });
});
