import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  formatDecisionMessage,
  formatResolvedMessage,
  parseDecisionCallback,
  shortenDecisionId,
  type Decision,
  type DecisionCallback,
  type Resolution,
  type InlineKeyboardMarkup,
} from './telegram-decision.js';

export type TelegramDecisionApi = {
  sendMessage: (
    chatId: number,
    text: string,
    options?: { reply_markup?: InlineKeyboardMarkup | Record<string, unknown> },
  ) => Promise<{ message_id: number }>;
  editMessageText: (
    chatId: number,
    messageId: number,
    inlineMessageId: string | undefined,
    text: string,
  ) => Promise<unknown>;
  editMessageReplyMarkup: (
    chatId: number,
    messageId: number,
    inlineMessageId: string | undefined,
    replyMarkup: Record<string, unknown>,
  ) => Promise<unknown>;
};

export type TelegramDecisionBotOptions = {
  api: TelegramDecisionApi;
  chatId: number | undefined;
  panelUrl: string;
  apiKey: string;
  storagePath: string;
  fetchFn?: typeof fetch;
};

type StoredRecord = {
  decision_id: string;
  short_id: string;
  chat_id: number;
  message_id: number;
  option_ordinal_map?: string[];
  decision: Decision;
};

export type ExternalResolutionEvent = {
  decision_id: string;
  resolution: Resolution;
  source: string;
};

export type CallbackHandlerResult =
  | { forceReply: true; placeholder: string }
  | undefined;

const DEFER_1H_MS = 60 * 60 * 1000;

export class TelegramDecisionBot {
  private readonly api: TelegramDecisionApi;
  private readonly chatId: number | undefined;
  private readonly panelUrl: string;
  private readonly apiKey: string;
  private readonly storagePath: string;
  private readonly fetchFn: typeof fetch;

  private readonly byShortId = new Map<string, StoredRecord>();
  private readonly byDecisionId = new Map<string, StoredRecord>();
  private pendingAnswerReply: StoredRecord | undefined;

  constructor(options: TelegramDecisionBotOptions) {
    this.api = options.api;
    this.chatId = options.chatId;
    this.panelUrl = options.panelUrl;
    this.apiKey = options.apiKey;
    this.storagePath = options.storagePath;
    this.fetchFn = options.fetchFn ?? fetch;
    this.loadFromDisk();
  }

  async postDecision(decision: Decision): Promise<number | undefined> {
    if (this.chatId === undefined) return undefined;

    const { text, reply_markup } = formatDecisionMessage(decision, { panelUrl: this.panelUrl });
    const sent = await this.api.sendMessage(this.chatId, text, { reply_markup });

    const record: StoredRecord = {
      decision_id: decision.id,
      short_id: shortenDecisionId(decision.id),
      chat_id: this.chatId,
      message_id: sent.message_id,
      decision,
      ...(decision.type === 'pick'
        ? { option_ordinal_map: decision.options.map(o => o.id) }
        : {}),
    };

    this.remember(record);
    this.persist(record);
    return sent.message_id;
  }

  async handleCallback(data: string): Promise<CallbackHandlerResult> {
    const parsed = parseDecisionCallback(data);
    if (!parsed) return undefined;

    const record = this.byShortId.get(parsed.shortId);
    if (!record) return undefined;

    if (parsed.action === 'answer_reply') {
      this.pendingAnswerReply = record;
      const placeholder = record.decision.type === 'answer' ? (record.decision.placeholder ?? 'Your answer') : 'Your answer';
      return { forceReply: true, placeholder };
    }

    const resolution = this.buildResolution(record, parsed);
    if (!resolution) return undefined;

    await this.resolveOnPanel(record.decision_id, resolution);
    await this.editToResolved(record, resolution, 'telegram');
    return undefined;
  }

  async handleTextMessage({ chatId, text }: { chatId: number; text: string }): Promise<void> {
    const pending = this.pendingAnswerReply;
    if (!pending || pending.chat_id !== chatId) return;

    this.pendingAnswerReply = undefined;
    const resolution: Resolution = { type: 'answer', text };
    await this.resolveOnPanel(pending.decision_id, resolution);
    await this.editToResolved(pending, resolution, 'telegram');
  }

  async onExternalResolution(event: ExternalResolutionEvent): Promise<void> {
    const record = this.byDecisionId.get(event.decision_id);
    if (!record) return;
    await this.editToResolved(record, event.resolution, event.source);
  }

  getTrackedShortIds(): string[] {
    return Array.from(this.byShortId.keys());
  }

  private buildResolution(record: StoredRecord, callback: DecisionCallback): Resolution | undefined {
    if (callback.action === 'approve') return { type: 'approve', approved: true };
    if (callback.action === 'decline') return { type: 'approve', approved: false };

    if (callback.action === 'pick') {
      if (callback.ordinal === null) return { type: 'pick', option_id: null };
      const map = record.option_ordinal_map;
      if (!map || callback.ordinal >= map.length) return undefined;
      return { type: 'pick', option_id: map[callback.ordinal] };
    }

    if (callback.action === 'answer_suggested') {
      const decision = record.decision;
      if (decision.type !== 'answer' || !decision.suggested_answer) return undefined;
      return { type: 'answer', text: decision.suggested_answer };
    }

    if (callback.action === 'defer') {
      return { type: 'defer', defer_until: this.computeDeferUntil(callback.duration) };
    }

    return undefined;
  }

  private computeDeferUntil(duration: '1h' | 'tomorrow'): string {
    if (duration === '1h') {
      return new Date(Date.now() + DEFER_1H_MS).toISOString();
    }
    // "tomorrow" = next 09:00 local. We only have UTC here — approximate with next 09:00 UTC.
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(9, 0, 0, 0);
    return next.toISOString();
  }

  private async resolveOnPanel(decisionId: string, resolution: Resolution): Promise<void> {
    const url = `${this.panelUrl.replace(/\/$/, '')}/api/decisions/${decisionId}/resolve`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(resolution),
    });
    if (!response.ok) {
      const snippet = await response.text().catch(() => '');
      throw new Error(`Decision resolve failed (${response.status}): ${snippet.slice(0, 200)}`);
    }
  }

  private async editToResolved(
    record: StoredRecord,
    resolution: Resolution,
    source: string,
  ): Promise<void> {
    const text = formatResolvedMessage(record.decision, resolution, { source });
    await this.api.editMessageText(record.chat_id, record.message_id, undefined, text);
    await this.api.editMessageReplyMarkup(record.chat_id, record.message_id, undefined, {});
  }

  private remember(record: StoredRecord): void {
    this.byShortId.set(record.short_id, record);
    this.byDecisionId.set(record.decision_id, record);
  }

  private persist(record: StoredRecord): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    appendFileSync(this.storagePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    const raw = readFileSync(this.storagePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as StoredRecord;
        if (record.decision_id && record.short_id && record.chat_id && record.message_id) {
          this.remember(record);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}
