import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
import type { Channel, ChannelReply, ReplyCallback } from './channel.js';
import { formatSlackNotification } from './slack-formatter.js';
import { sanitizeText } from '../server/security-utils.js';
import { toErrorMessage } from '../util/errors.js';

/**
 * Thin seam over the Slack Web API so the channel logic is testable without a
 * live workspace. Backed by `@slack/web-api` in production.
 */
export type SlackApi = {
  postMessage: (
    channel: string,
    text: string,
    blocks?: unknown[],
  ) => Promise<{ ts: string; channel: string }>;
  updateMessage?: (channel: string, ts: string, text: string, blocks?: unknown[]) => Promise<unknown>;
};

type SlackChannelOptions = {
  api: SlackApi;
  /** The DM/channel to post to. Learned from the first inbound message. */
  channelId?: string;
  socket?: { start: () => Promise<void>; disconnect: () => Promise<void> };
  onSocketError?: (error: unknown) => void;
};

const ACTION_SEPARATOR = ':';
const MAX_SLACK_TEXT_LENGTH = 3_000;

/** Encodes option index + interaction id into a Block Kit button value. */
export function encodeActionValue(interactionId: string, optionIndex: number): string {
  return `${optionIndex}${ACTION_SEPARATOR}${interactionId}`;
}

export function parseActionValue(
  value: string,
): { interactionId: string; optionIndex: number } | undefined {
  const sepIndex = value.indexOf(ACTION_SEPARATOR);
  if (sepIndex < 1) return undefined;
  const optionIndex = parseInt(value.slice(0, sepIndex), 10);
  const interactionId = value.slice(sepIndex + 1);
  if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex > 100 || !interactionId) {
    return undefined;
  }
  return { interactionId, optionIndex };
}

export function formatSlackMessage(request: InteractionRequest): string {
  const lines: string[] = [request.message];

  if (request.options) {
    const withDescriptions = request.options.filter((o) => o.description);
    if (withDescriptions.length > 0) {
      lines.push('');
      for (const opt of withDescriptions) lines.push(`${opt.label}: ${opt.description}`);
    }
  }

  if (request.freeText && request.options) {
    lines.push('');
    lines.push('(or type a reply)');
  }

  return sanitizeText(lines.join('\n'), MAX_SLACK_TEXT_LENGTH);
}

/**
 * Block Kit layout for an interaction: a section with the prompt, then one
 * button per option carrying the encoded (interactionId, index) as its value.
 * Free-text-only requests get just the section — the reply arrives as a message.
 */
export function buildSlackBlocks(interactionId: string, request: InteractionRequest): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: formatSlackMessage(request) } },
  ];

  if (request.options && request.options.length > 0) {
    blocks.push({
      type: 'actions',
      elements: request.options.map((opt, i) => ({
        type: 'button',
        text: { type: 'plain_text', text: sanitizeText(opt.label, 75) },
        action_id: `option_${i}`,
        value: encodeActionValue(interactionId, i),
      })),
    });
  }

  return blocks;
}

export type MessageCallback = (text: string) => void;

export class SlackChannel implements Channel {
  readonly name = 'slack';
  private api: SlackApi;
  private channelId: string | undefined;
  private callbacks: ReplyCallback[] = [];
  private messageCallbacks: MessageCallback[] = [];
  private pendingInteractions = new Map<string, InteractionRequest>();
  private sentMessages = new Map<string, { ts: string; channel: string }>();
  private lastPendingId: string | undefined;
  private socket: { start: () => Promise<void>; disconnect: () => Promise<void> } | undefined;
  private onSocketError: (error: unknown) => void;

  constructor(options: SlackChannelOptions) {
    this.api = options.api;
    this.channelId = options.channelId;
    this.socket = options.socket;
    this.onSocketError = options.onSocketError ?? ((error) => {
      const message = toErrorMessage(error);
      console.error(`[slack] Socket Mode error: ${message}`);
    });
  }

  async start(): Promise<void> {
    if (this.socket) {
      try {
        await this.socket.start();
        console.log('Slack bot connected (Socket Mode)');
      } catch (error) {
        this.onSocketError(error);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.socket) await this.socket.disconnect();
  }

  onReply(callback: ReplyCallback): void {
    this.callbacks.push(callback);
  }

  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  handleIncomingMessage(text: string): void {
    const lastId = this.lastPendingId;
    if (lastId && this.pendingInteractions.has(lastId)) {
      this.handleTextReply(lastId, text);
      return;
    }

    const safeText = sanitizeText(text, MAX_SLACK_TEXT_LENGTH);
    if (!safeText) return;
    for (const cb of this.messageCallbacks) cb(safeText);
  }

  setChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  getChannelId(): string | undefined {
    return this.channelId;
  }

  private hasChannel(): boolean {
    if (!this.channelId) {
      console.warn('Slack: no channel configured. DM the bot first to pair it.');
      return false;
    }
    return true;
  }

  async notify(data: NotificationData): Promise<number | undefined> {
    if (!this.hasChannel()) return undefined;
    const text = formatSlackNotification(data);
    await this.api.postMessage(this.channelId as string, sanitizeText(text, MAX_SLACK_TEXT_LENGTH));
    return undefined;
  }

  async notifyText(message: string): Promise<void> {
    if (!this.hasChannel()) return;
    await this.api.postMessage(this.channelId as string, sanitizeText(message, MAX_SLACK_TEXT_LENGTH));
  }

  async send(interactionId: string, request: InteractionRequest): Promise<void> {
    if (!this.hasChannel()) return;

    const text = formatSlackMessage(request);
    const blocks = buildSlackBlocks(interactionId, request);
    const result = await this.api.postMessage(this.channelId as string, text, blocks);

    this.pendingInteractions.set(interactionId, request);
    this.lastPendingId = interactionId;
    this.sentMessages.set(interactionId, { ts: result.ts, channel: result.channel });
  }

  handleBlockAction(actionValue: string): void {
    const parsed = parseActionValue(actionValue);
    if (!parsed) return;

    const request = this.pendingInteractions.get(parsed.interactionId);
    const option = request?.options?.[parsed.optionIndex];
    if (!option) return;

    this.pendingInteractions.delete(parsed.interactionId);
    this.clearLastPendingIfMatches(parsed.interactionId);
    const reply: ChannelReply = {
      interactionId: parsed.interactionId,
      selectedValue: sanitizeText(option.value, 500),
    };
    for (const cb of this.callbacks) cb(reply);
  }

  handleTextReply(interactionId: string, text: string): void {
    if (!this.pendingInteractions.has(interactionId)) return;
    this.pendingInteractions.delete(interactionId);
    this.clearLastPendingIfMatches(interactionId);
    const reply: ChannelReply = { interactionId, freeText: sanitizeText(text, 500) };
    for (const cb of this.callbacks) cb(reply);
  }

  async expireInteraction(interactionId: string): Promise<void> {
    const sent = this.sentMessages.get(interactionId);
    this.pendingInteractions.delete(interactionId);
    this.clearLastPendingIfMatches(interactionId);
    if (!sent) return;

    this.sentMessages.delete(interactionId);
    if (this.api.updateMessage) {
      await this.api.updateMessage(sent.channel, sent.ts, 'This request has expired.', []);
    }
  }

  getLastPendingInteractionId(): string | undefined {
    return this.lastPendingId;
  }

  hasPendingInteraction(interactionId: string): boolean {
    return this.pendingInteractions.has(interactionId);
  }

  private clearLastPendingIfMatches(interactionId: string): void {
    if (this.lastPendingId === interactionId) this.lastPendingId = undefined;
  }
}

async function loadChannelId(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as { channelId?: unknown };
    return typeof data.channelId === 'string' && data.channelId ? data.channelId : undefined;
  } catch {
    return undefined;
  }
}

async function saveChannelId(path: string, channelId: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ channelId }), { encoding: 'utf-8', mode: 0o600 });
}

type CreateSlackChannelOptions = {
  botToken: string;
  appToken: string;
  channelIdPath: string;
};

/**
 * Wires a SlackChannel to a live workspace over Socket Mode (no public URL,
 * matching the Telegram long-polling model). The bot token drives the Web API
 * for sending; the app-level token opens the Socket Mode WebSocket for
 * receiving messages and button clicks. The DM channel is learned from the
 * first inbound message and persisted to `channelIdPath`.
 */
export async function createSlackChannel(
  options: CreateSlackChannelOptions,
): Promise<SlackChannel> {
  const web = new WebClient(options.botToken);
  const socket = new SocketModeClient({ appToken: options.appToken });
  const channelId = await loadChannelId(options.channelIdPath);

  const channel = new SlackChannel({
    api: {
      postMessage: async (ch, text, blocks) => {
        const res = await web.chat.postMessage({
          channel: ch,
          text,
          ...(blocks && blocks.length > 0 ? { blocks: blocks as never } : {}),
        });
        return { ts: String(res.ts), channel: String(res.channel) };
      },
      updateMessage: (ch, ts, text, blocks) =>
        web.chat.update({ channel: ch, ts, text, blocks: (blocks ?? []) as never }),
    },
    channelId,
    socket: {
      start: async () => {
        await socket.start();
      },
      disconnect: () => socket.disconnect(),
    },
  });

  // Learn (and persist) the DM channel the first time the user writes to the bot.
  const pairChannel = async (ch: string): Promise<void> => {
    if (channel.getChannelId()) return;
    channel.setChannelId(ch);
    await saveChannelId(options.channelIdPath, ch);
  };

  socket.on('message', async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
    await ack();
    // Ignore the bot's own messages and non-user message subtypes (edits, joins).
    if (!event || event.bot_id || event.subtype || typeof event.text !== 'string') return;
    if (event.channel_type && event.channel_type !== 'im') {
      // Only DMs pair/route by default; ignore channel chatter unless already paired to it.
      if (channel.getChannelId() !== event.channel) return;
    }
    await pairChannel(event.channel);
    if (channel.getChannelId() !== event.channel) {
      console.warn(
        `[slack] Ignoring message on ${event.channel}: paired to ${channel.getChannelId()}. ` +
        `Delete slack.json to re-pair (e.g. after switching bots).`,
      );
      return;
    }
    console.log(`[slack] Message received on ${event.channel}, routing`);
    channel.handleIncomingMessage(event.text);
  });

  socket.on('interactive', async ({ body, ack }: { body: SlackInteractivePayload; ack: () => Promise<void> }) => {
    await ack();
    const action = body?.actions?.[0];
    const ch = body?.channel?.id;
    if (!action || !ch || channel.getChannelId() !== ch) return;
    if (typeof action.value === 'string') channel.handleBlockAction(action.value);
  });

  return channel;
}

type SlackMessageEvent = {
  channel: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  channel_type?: string;
};

type SlackInteractivePayload = {
  actions?: Array<{ value?: string; action_id?: string }>;
  channel?: { id?: string };
};
