import { Bot, InlineKeyboard } from 'grammy';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
import type { Channel, ReplyCallback } from './channel.js';
type TelegramApi = {
    sendMessage: (chatId: number, text: string, options?: Record<string, unknown>) => Promise<{
        message_id: number;
    }>;
    answerCallbackQuery: (queryId: string) => Promise<boolean>;
    editMessageText?: (chatId: number, messageId: number, inlineMessageId: string | undefined, text: string) => Promise<unknown>;
    editMessageReplyMarkup?: (chatId: number, messageId: number, inlineMessageId: string | undefined, replyMarkup: Record<string, unknown>) => Promise<unknown>;
};
type TelegramChannelOptions = {
    api: TelegramApi;
    chatId?: number;
    bot?: Bot;
};
export declare function encodeCallbackData(interactionId: string, optionIndex: number): string;
export declare function parseCallbackData(data: string): {
    interactionId: string;
    optionIndex: number;
} | undefined;
export declare function formatTelegramMessage(request: InteractionRequest): string;
export declare function buildInlineKeyboard(interactionId: string, request: InteractionRequest): InlineKeyboard | undefined;
export type MessageCallback = (text: string) => void;
export declare class TelegramChannel implements Channel {
    readonly name = "telegram";
    private api;
    private chatId;
    private callbacks;
    private messageCallbacks;
    private pendingInteractions;
    private sentMessages;
    private lastPendingId;
    private bot;
    constructor(options: TelegramChannelOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    onReply(callback: ReplyCallback): void;
    onMessage(callback: MessageCallback): void;
    handleIncomingMessage(text: string): void;
    setChatId(chatId: number): void;
    getChatId(): number | undefined;
    private hasChatId;
    notify(data: NotificationData): Promise<number | undefined>;
    notifyText(message: string): Promise<number | undefined>;
    send(interactionId: string, request: InteractionRequest): Promise<void>;
    handleCallbackQuery(interactionId: string, optionIndex: number): void;
    handleTextReply(interactionId: string, text: string): void;
    expireInteraction(interactionId: string): Promise<void>;
    getLastPendingInteractionId(): string | undefined;
    hasPendingInteraction(interactionId: string): boolean;
    private clearLastPendingIfMatches;
}
type CreateTelegramChannelOptions = {
    botToken: string;
    chatIdPath: string;
};
export declare function createTelegramChannel(options: CreateTelegramChannelOptions): Promise<TelegramChannel>;
export {};
//# sourceMappingURL=telegram.d.ts.map