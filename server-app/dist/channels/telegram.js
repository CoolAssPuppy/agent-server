import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Bot, InlineKeyboard } from 'grammy';
import { formatTelegramNotification } from './telegram-formatter.js';
import { sanitizeText } from '../server/security-utils.js';
const CALLBACK_SEPARATOR = ':';
const MAX_TELEGRAM_TEXT_LENGTH = 2_000;
export function encodeCallbackData(interactionId, optionIndex) {
    return `${optionIndex}${CALLBACK_SEPARATOR}${interactionId}`;
}
export function parseCallbackData(data) {
    const sepIndex = data.indexOf(CALLBACK_SEPARATOR);
    if (sepIndex < 1)
        return undefined;
    const indexStr = data.slice(0, sepIndex);
    const interactionId = data.slice(sepIndex + 1);
    const optionIndex = parseInt(indexStr, 10);
    if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex > 100 || !interactionId)
        return undefined;
    return { interactionId, optionIndex };
}
export function formatTelegramMessage(request) {
    const lines = [request.message];
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
export function buildInlineKeyboard(interactionId, request) {
    if (!request.options || request.options.length === 0)
        return undefined;
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
export class TelegramChannel {
    name = 'telegram';
    api;
    chatId;
    callbacks = [];
    messageCallbacks = [];
    pendingInteractions = new Map();
    sentMessages = new Map();
    lastPendingId;
    bot;
    constructor(options) {
        this.api = options.api;
        this.chatId = options.chatId;
        this.bot = options.bot;
    }
    async start() {
        if (this.bot) {
            this.bot.start({
                drop_pending_updates: true,
                onStart: (botInfo) => {
                    console.log(`Telegram bot @${botInfo.username} connected (long-polling)`);
                },
            });
        }
    }
    async stop() {
        if (this.bot) {
            await this.bot.stop();
        }
    }
    onReply(callback) {
        this.callbacks.push(callback);
    }
    onMessage(callback) {
        this.messageCallbacks.push(callback);
    }
    handleIncomingMessage(text) {
        if (this.pendingInteractions.size > 0)
            return;
        const safeText = sanitizeText(text, MAX_TELEGRAM_TEXT_LENGTH);
        if (!safeText)
            return;
        for (const cb of this.messageCallbacks) {
            cb(safeText);
        }
    }
    setChatId(chatId) {
        this.chatId = chatId;
    }
    getChatId() {
        return this.chatId;
    }
    hasChatId() {
        if (!this.chatId) {
            console.warn('Telegram: no chat ID configured. Send /start to the bot first.');
            return false;
        }
        return true;
    }
    async notify(data) {
        if (!this.hasChatId())
            return undefined;
        const text = formatTelegramNotification(data);
        const result = await this.api.sendMessage(this.chatId, sanitizeText(text, MAX_TELEGRAM_TEXT_LENGTH));
        return result.message_id;
    }
    async notifyText(message) {
        if (!this.hasChatId())
            return undefined;
        const result = await this.api.sendMessage(this.chatId, sanitizeText(message, MAX_TELEGRAM_TEXT_LENGTH));
        return result.message_id;
    }
    async send(interactionId, request) {
        if (!this.hasChatId())
            return;
        const text = formatTelegramMessage(request);
        const keyboard = buildInlineKeyboard(interactionId, request);
        const options = {};
        if (keyboard) {
            options.reply_markup = keyboard;
        }
        const result = await this.api.sendMessage(this.chatId, text, Object.keys(options).length > 0 ? options : undefined);
        this.pendingInteractions.set(interactionId, request);
        this.lastPendingId = interactionId;
        this.sentMessages.set(interactionId, { messageId: result.message_id, chatId: this.chatId });
    }
    handleCallbackQuery(interactionId, optionIndex) {
        const request = this.pendingInteractions.get(interactionId);
        if (!request?.options)
            return;
        const option = request.options[optionIndex];
        if (!option)
            return;
        this.pendingInteractions.delete(interactionId);
        this.clearLastPendingIfMatches(interactionId);
        const reply = { interactionId, selectedValue: sanitizeText(option.value, 500) };
        for (const cb of this.callbacks) {
            cb(reply);
        }
    }
    handleTextReply(interactionId, text) {
        const request = this.pendingInteractions.get(interactionId);
        if (!request)
            return;
        this.pendingInteractions.delete(interactionId);
        this.clearLastPendingIfMatches(interactionId);
        const reply = { interactionId, freeText: sanitizeText(text, 500) };
        for (const cb of this.callbacks) {
            cb(reply);
        }
    }
    async expireInteraction(interactionId) {
        const sentMessage = this.sentMessages.get(interactionId);
        this.pendingInteractions.delete(interactionId);
        this.clearLastPendingIfMatches(interactionId);
        if (!sentMessage)
            return;
        this.sentMessages.delete(interactionId);
        if (this.api.editMessageText) {
            await this.api.editMessageText(sentMessage.chatId, sentMessage.messageId, undefined, 'This request has expired.');
        }
        if (this.api.editMessageReplyMarkup) {
            await this.api.editMessageReplyMarkup(sentMessage.chatId, sentMessage.messageId, undefined, {});
        }
    }
    getLastPendingInteractionId() {
        return this.lastPendingId;
    }
    hasPendingInteraction(interactionId) {
        return this.pendingInteractions.has(interactionId);
    }
    clearLastPendingIfMatches(interactionId) {
        if (this.lastPendingId === interactionId) {
            this.lastPendingId = undefined;
        }
    }
}
async function loadChatId(path) {
    try {
        const content = await readFile(path, 'utf-8');
        const data = JSON.parse(content);
        if (typeof data.chatId !== 'number' || !Number.isSafeInteger(data.chatId) || data.chatId <= 0) {
            return undefined;
        }
        return data.chatId;
    }
    catch {
        return undefined;
    }
}
async function saveChatId(path, chatId) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ chatId }), { encoding: 'utf-8', mode: 0o600 });
}
export async function createTelegramChannel(options) {
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
    bot.on('callback_query:data', async (ctx) => {
        const currentChatId = channel.getChatId();
        if (!currentChatId || ctx.chat?.id !== currentChatId) {
            await ctx.answerCallbackQuery();
            return;
        }
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
        const currentChatId = channel.getChatId();
        if (!currentChatId || ctx.chat.id !== currentChatId) {
            return;
        }
        const lastId = channel.getLastPendingInteractionId();
        if (lastId && channel.hasPendingInteraction(lastId)) {
            channel.handleTextReply(lastId, ctx.message.text);
            return;
        }
        channel.handleIncomingMessage(ctx.message.text);
    });
    return channel;
}
//# sourceMappingURL=telegram.js.map