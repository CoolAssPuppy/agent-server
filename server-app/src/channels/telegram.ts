import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Bot, InlineKeyboard } from 'grammy';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
import type { Channel, ChannelReply, ReplyCallback } from './channel.js';
import { formatTelegramNotification } from './telegram-formatter.js';
import { sanitizeText } from '../server/security-utils.js';
import { TelegramDecisionBot } from './telegram-decision-bot.js';
import type { Decision } from './telegram-decision.js';

type TelegramApi = {
  sendMessage: (chatId: number, text: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
  answerCallbackQuery: (queryId: string) => Promise<boolean>;
  editMessageText?: (chatId: number, messageId: number, inlineMessageId: string | undefined, text: string) => Promise<unknown>;
  editMessageReplyMarkup?: (chatId: number, messageId: number, inlineMessageId: string | undefined, replyMarkup: Record<string, unknown>) => Promise<unknown>;
};

type TelegramChannelOptions = {
  api: TelegramApi;
  chatId?: number;
  bot?: Bot;
};

const CALLBACK_SEPARATOR = ':';
const MAX_TELEGRAM_TEXT_LENGTH = 2_000;

export function encodeCallbackData(interactionId: string, optionIndex: number): string {
  return `${optionIndex}${CALLBACK_SEPARATOR}${interactionId}`;
}

export function parseCallbackData(data: string): { interactionId: string; optionIndex: number } | undefined {
  const sepIndex = data.indexOf(CALLBACK_SEPARATOR);
  if (sepIndex < 1) return undefined;

  const indexStr = data.slice(0, sepIndex);
  const interactionId = data.slice(sepIndex + 1);
  const optionIndex = parseInt(indexStr, 10);

  if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex > 100 || !interactionId) return undefined;

  return { interactionId, optionIndex };
}

export function formatTelegramMessage(request: InteractionRequest): string {
  const lines: string[] = [request.message];

  if (request.options) {
    const withDescriptions = request.options.filter((o) => o.description);
    if (withDescriptions.length > 0) {
      lines.push('');
      for (const opt of withDescriptions) {
        lines.push(`${opt.label}: ${opt.description}`);
      }
    }
  }

  if (request.freeText && request.options) {
    lines.push('');
    lines.push('(or type a reply)');
  }

  return sanitizeText(lines.join('\n'), MAX_TELEGRAM_TEXT_LENGTH);
}

export function buildInlineKeyboard(
  interactionId: string,
  request: InteractionRequest,
): InlineKeyboard | undefined {
  if (!request.options || request.options.length === 0) return undefined;

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < request.options.length; i++) {
    const opt = request.options[i];
    const callbackData = encodeCallbackData(interactionId, i);
    keyboard.text(sanitizeText(opt.label, 64), callbackData);
    if (i < request.options.length - 1) {
      keyboard.row();
    }
  }

  return keyboard;
}

export type MessageCallback = (text: string) => void;

export class TelegramChannel implements Channel {
  readonly name = 'telegram';
  private api: TelegramApi;
  private chatId: number | undefined;
  private callbacks: ReplyCallback[] = [];
  private messageCallbacks: MessageCallback[] = [];
  private pendingInteractions = new Map<string, InteractionRequest>();
  private sentMessages = new Map<string, { messageId: number; chatId: number }>();
  private lastPendingId: string | undefined;
  private bot: Bot | undefined;

  constructor(options: TelegramChannelOptions) {
    this.api = options.api;
    this.chatId = options.chatId;
    this.bot = options.bot;
  }

  async start(): Promise<void> {
    if (this.bot) {
      this.bot.start({
        drop_pending_updates: true,
        onStart: (botInfo) => {
          console.log(`Telegram bot @${botInfo.username} connected (long-polling)`);
        },
      });
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  onReply(callback: ReplyCallback): void {
    this.callbacks.push(callback);
  }

  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  handleIncomingMessage(text: string): void {
    if (this.pendingInteractions.size > 0) return;

    const safeText = sanitizeText(text, MAX_TELEGRAM_TEXT_LENGTH);
    if (!safeText) return;

    for (const cb of this.messageCallbacks) {
      cb(safeText);
    }
  }

  setChatId(chatId: number): void {
    this.chatId = chatId;
  }

  getChatId(): number | undefined {
    return this.chatId;
  }

  private hasChatId(): boolean {
    if (!this.chatId) {
      console.warn('Telegram: no chat ID configured. Send /start to the bot first.');
      return false;
    }
    return true;
  }

  async notify(data: NotificationData): Promise<number | undefined> {
    if (!this.hasChatId()) return undefined;
    const text = formatTelegramNotification(data);
    const result = await this.api.sendMessage(this.chatId as number, sanitizeText(text, MAX_TELEGRAM_TEXT_LENGTH));
    return result.message_id;
  }

  async notifyText(message: string): Promise<number | undefined> {
    if (!this.hasChatId()) return undefined;
    const result = await this.api.sendMessage(this.chatId as number, sanitizeText(message, MAX_TELEGRAM_TEXT_LENGTH));
    return result.message_id;
  }

  async send(interactionId: string, request: InteractionRequest): Promise<void> {
    if (!this.hasChatId()) return;

    const text = formatTelegramMessage(request);
    const keyboard = buildInlineKeyboard(interactionId, request);

    const options: Record<string, unknown> = {};
    if (keyboard) {
      options.reply_markup = keyboard;
    }

    const result = await this.api.sendMessage(this.chatId as number, text, Object.keys(options).length > 0 ? options : undefined);
    this.pendingInteractions.set(interactionId, request);
    this.lastPendingId = interactionId;
    this.sentMessages.set(interactionId, { messageId: result.message_id, chatId: this.chatId as number });
  }

  handleCallbackQuery(interactionId: string, optionIndex: number): void {
    const request = this.pendingInteractions.get(interactionId);
    if (!request?.options) return;

    const option = request.options[optionIndex];
    if (!option) return;

    this.pendingInteractions.delete(interactionId);
    this.clearLastPendingIfMatches(interactionId);
    const reply: ChannelReply = { interactionId, selectedValue: sanitizeText(option.value, 500) };
    for (const cb of this.callbacks) {
      cb(reply);
    }
  }

  handleTextReply(interactionId: string, text: string): void {
    const request = this.pendingInteractions.get(interactionId);
    if (!request) return;

    this.pendingInteractions.delete(interactionId);
    this.clearLastPendingIfMatches(interactionId);
    const reply: ChannelReply = { interactionId, freeText: sanitizeText(text, 500) };
    for (const cb of this.callbacks) {
      cb(reply);
    }
  }

  async expireInteraction(interactionId: string): Promise<void> {
    const sentMessage = this.sentMessages.get(interactionId);
    this.pendingInteractions.delete(interactionId);
    this.clearLastPendingIfMatches(interactionId);
    if (!sentMessage) return;

    this.sentMessages.delete(interactionId);

    if (this.api.editMessageText) {
      await this.api.editMessageText(sentMessage.chatId, sentMessage.messageId, undefined, 'This request has expired.');
    }
    if (this.api.editMessageReplyMarkup) {
      await this.api.editMessageReplyMarkup(sentMessage.chatId, sentMessage.messageId, undefined, {});
    }
  }

  getLastPendingInteractionId(): string | undefined {
    return this.lastPendingId;
  }

  hasPendingInteraction(interactionId: string): boolean {
    return this.pendingInteractions.has(interactionId);
  }

  private clearLastPendingIfMatches(interactionId: string): void {
    if (this.lastPendingId === interactionId) {
      this.lastPendingId = undefined;
    }
  }
}

async function loadChatId(path: string): Promise<number | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as { chatId?: unknown };
    if (typeof data.chatId !== 'number' || !Number.isSafeInteger(data.chatId) || data.chatId <= 0) {
      return undefined;
    }
    return data.chatId;
  } catch {
    return undefined;
  }
}

async function saveChatId(path: string, chatId: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ chatId }), { encoding: 'utf-8', mode: 0o600 });
}

type CreateTelegramChannelOptions = {
  botToken: string;
  chatIdPath: string;
  decisions?: {
    panelUrl: string;
    apiKey: string;
    storagePath: string;
  };
};

export type TelegramChannelWithDecisions = TelegramChannel & {
  postDecision: (decision: Decision) => Promise<number | undefined>;
  onExternalResolution: TelegramDecisionBot['onExternalResolution'];
};

export async function createTelegramChannel(
  options: CreateTelegramChannelOptions,
): Promise<TelegramChannel> {
  const bot = new Bot(options.botToken);
  const chatId = await loadChatId(options.chatIdPath);

  const channel = new TelegramChannel({
    api: {
      sendMessage: (cId, text, opts) => bot.api.sendMessage(cId, text, opts),
      answerCallbackQuery: (qId) => bot.api.answerCallbackQuery(qId),
      editMessageText: (cId, msgId, _inlineId, text) => bot.api.editMessageText(cId, msgId, text),
      editMessageReplyMarkup: (cId, msgId) => bot.api.editMessageReplyMarkup(cId, msgId),
    },
    chatId,
    bot,
  });

  bot.command('start', async (ctx) => {
    const newChatId = ctx.chat.id;
    const existingChatId = channel.getChatId();
    if (existingChatId && existingChatId !== newChatId) {
      await ctx.reply('This bot is already linked to a different chat.');
      return;
    }

    channel.setChatId(newChatId);
    await saveChatId(options.chatIdPath, newChatId);
    await ctx.reply('Agent Server connected. You will receive interaction requests here.');
  });

  const decisionBot = options.decisions
    ? new TelegramDecisionBot({
        api: {
          sendMessage: (cId, text, opts) => bot.api.sendMessage(cId, text, opts as Record<string, unknown> | undefined),
          editMessageText: (cId, msgId, _inlineId, text) => bot.api.editMessageText(cId, msgId, text),
          editMessageReplyMarkup: (cId, msgId) => bot.api.editMessageReplyMarkup(cId, msgId),
        },
        chatId,
        panelUrl: options.decisions.panelUrl,
        apiKey: options.decisions.apiKey,
        storagePath: options.decisions.storagePath,
      })
    : undefined;

  bot.on('callback_query:data', async (ctx) => {
    const currentChatId = channel.getChatId();
    if (!currentChatId || ctx.chat?.id !== currentChatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    const data = ctx.callbackQuery.data;

    if (decisionBot && data.startsWith('dec:')) {
      const result = await decisionBot.handleCallback(data);
      if (result?.forceReply) {
        await ctx.reply('Type your answer:', {
          reply_markup: { force_reply: true, input_field_placeholder: result.placeholder },
        });
      }
      await ctx.answerCallbackQuery();
      return;
    }

    const parsed = parseCallbackData(data);
    if (!parsed) {
      await ctx.answerCallbackQuery();
      return;
    }

    channel.handleCallbackQuery(parsed.interactionId, parsed.optionIndex);
    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', async (ctx) => {
    const currentChatId = channel.getChatId();
    if (!currentChatId || ctx.chat.id !== currentChatId) {
      return;
    }

    if (decisionBot) {
      await decisionBot.handleTextMessage({ chatId: ctx.chat.id, text: ctx.message.text });
    }

    const lastId = channel.getLastPendingInteractionId();
    if (lastId && channel.hasPendingInteraction(lastId)) {
      channel.handleTextReply(lastId, ctx.message.text);
      return;
    }

    channel.handleIncomingMessage(ctx.message.text);
  });

  if (decisionBot) {
    const enriched = channel as TelegramChannelWithDecisions;
    enriched.postDecision = (d) => decisionBot.postDecision(d);
    enriched.onExternalResolution = (e) => decisionBot.onExternalResolution(e);
  }

  return channel;
}
