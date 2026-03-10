import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Bot, InlineKeyboard } from 'grammy';
import type { InteractionRequest } from '../interaction/schema.js';
import type { Channel, ChannelReply, ReplyCallback } from './channel.js';

type TelegramApi = {
  sendMessage: (chatId: number, text: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
  answerCallbackQuery: (queryId: string) => Promise<boolean>;
};

type TelegramChannelOptions = {
  api: TelegramApi;
  chatId?: number;
  bot?: Bot;
};

const CALLBACK_SEPARATOR = ':';

export function encodeCallbackData(interactionId: string, optionIndex: number): string {
  return `${optionIndex}${CALLBACK_SEPARATOR}${interactionId}`;
}

export function parseCallbackData(data: string): { interactionId: string; optionIndex: number } | undefined {
  const sepIndex = data.indexOf(CALLBACK_SEPARATOR);
  if (sepIndex < 1) return undefined;

  const indexStr = data.slice(0, sepIndex);
  const interactionId = data.slice(sepIndex + 1);
  const optionIndex = parseInt(indexStr, 10);

  if (isNaN(optionIndex) || !interactionId) return undefined;

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

  return lines.join('\n');
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
    keyboard.text(opt.label, callbackData);
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

    for (const cb of this.messageCallbacks) {
      cb(text);
    }
  }

  setChatId(chatId: number): void {
    this.chatId = chatId;
  }

  private hasChatId(): boolean {
    if (!this.chatId) {
      console.warn('Telegram: no chat ID configured. Send /start to the bot first.');
      return false;
    }
    return true;
  }

  async notify(message: string): Promise<void> {
    if (!this.hasChatId()) return;
    await this.api.sendMessage(this.chatId as number, message);
  }

  async send(interactionId: string, request: InteractionRequest): Promise<void> {
    if (!this.hasChatId()) return;

    const text = formatTelegramMessage(request);
    const keyboard = buildInlineKeyboard(interactionId, request);

    const options: Record<string, unknown> = {};
    if (keyboard) {
      options.reply_markup = keyboard;
    }

    this.pendingInteractions.set(interactionId, request);
    this.lastPendingId = interactionId;
    await this.api.sendMessage(this.chatId as number, text, Object.keys(options).length > 0 ? options : undefined);
  }

  handleCallbackQuery(interactionId: string, optionIndex: number): void {
    const request = this.pendingInteractions.get(interactionId);
    if (!request?.options) return;

    const option = request.options[optionIndex];
    if (!option) return;

    this.pendingInteractions.delete(interactionId);
    const reply: ChannelReply = { interactionId, selectedValue: option.value };
    for (const cb of this.callbacks) {
      cb(reply);
    }
  }

  handleTextReply(interactionId: string, text: string): void {
    const request = this.pendingInteractions.get(interactionId);
    if (!request) return;

    this.pendingInteractions.delete(interactionId);
    const reply: ChannelReply = { interactionId, freeText: text };
    for (const cb of this.callbacks) {
      cb(reply);
    }
  }

  getLastPendingInteractionId(): string | undefined {
    return this.lastPendingId;
  }
}

async function loadChatId(path: string): Promise<number | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as { chatId?: number };
    return data.chatId;
  } catch {
    return undefined;
  }
}

async function saveChatId(path: string, chatId: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ chatId }), 'utf-8');
}

type CreateTelegramChannelOptions = {
  botToken: string;
  chatIdPath: string;
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
    },
    chatId,
    bot,
  });

  bot.command('start', async (ctx) => {
    const newChatId = ctx.chat.id;
    channel.setChatId(newChatId);
    await saveChatId(options.chatIdPath, newChatId);
    await ctx.reply('Agent Server connected. You will receive interaction requests here.');
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parsed = parseCallbackData(data);
    if (!parsed) {
      await ctx.answerCallbackQuery();
      return;
    }

    channel.handleCallbackQuery(parsed.interactionId, parsed.optionIndex);
    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', (ctx) => {
    const lastId = channel.getLastPendingInteractionId();
    if (lastId) {
      channel.handleTextReply(lastId, ctx.message.text);
      return;
    }

    channel.handleIncomingMessage(ctx.message.text);
  });

  return channel;
}
