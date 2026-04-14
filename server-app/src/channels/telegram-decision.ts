import { sanitizeText } from '../server/security-utils.js';

export const MAX_TELEGRAM_CALLBACK_BYTES = 64;
export const DECISION_ID_SHORT_LENGTH = 12;
const MAX_BUTTON_LABEL = 30;
const MAX_MESSAGE_CHARS = 2_000;

export type DecisionSource = {
  title: string;
  url: string;
  kind: string;
};

export type DecisionBase = {
  id: string;
  task_run_id: string;
  agent_slug: string;
  title: string;
  body?: string;
  reasoning?: string;
  confidence?: number;
  sources?: DecisionSource[];
  due_at?: string;
  created_at: string;
};

export type ApproveDecision = DecisionBase & {
  type: 'approve';
  approve_label?: string;
  decline_label?: string;
  recommendation?: 'approve' | 'decline';
};

export type PickOption = {
  id: string;
  label: string;
  description?: string;
};

export type PickDecision = DecisionBase & {
  type: 'pick';
  options: PickOption[];
  allow_none?: boolean;
  recommended_option_id?: string;
};

export type AnswerDecision = DecisionBase & {
  type: 'answer';
  prompt: string;
  placeholder?: string;
  suggested_answer?: string;
  max_length?: number;
};

export type Decision = ApproveDecision | PickDecision | AnswerDecision;

export type ApproveResolution =
  | { type: 'approve'; approved: true }
  | { type: 'approve'; approved: false };

export type PickResolution =
  | { type: 'pick'; option_id: string }
  | { type: 'pick'; option_id: null };

export type AnswerResolution = { type: 'answer'; text: string };

export type DeferResolution = { type: 'defer'; defer_until: string };

export type Resolution = ApproveResolution | PickResolution | AnswerResolution | DeferResolution;

export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineButton[][];
};

export type FormattedDecisionMessage = {
  text: string;
  reply_markup: InlineKeyboardMarkup;
};

export type FormatOptions = {
  panelUrl?: string;
};

export type DecisionCallback =
  | { shortId: string; action: 'approve' | 'decline' }
  | { shortId: string; action: 'pick'; ordinal: number | null }
  | { shortId: string; action: 'answer_suggested' }
  | { shortId: string; action: 'answer_reply' }
  | { shortId: string; action: 'defer'; duration: '1h' | 'tomorrow' };

export function shortenDecisionId(id: string): string {
  const stripped = id.replace(/-/g, '');
  if (stripped.length <= DECISION_ID_SHORT_LENGTH) return stripped;
  return stripped.slice(-DECISION_ID_SHORT_LENGTH);
}

function clampLabel(label: string, fallback: string): string {
  const safe = sanitizeText(label || fallback, MAX_BUTTON_LABEL);
  return safe || fallback;
}

function formatHeaderLines(decision: Decision): string[] {
  const lines: string[] = [];
  lines.push(`\u{1F6A8} DECISION \u00B7 ${decision.agent_slug}`);
  lines.push('');
  lines.push(sanitizeText(decision.title, 200));
  if (decision.body) {
    lines.push('');
    lines.push(sanitizeText(decision.body, 1500));
  }
  return lines;
}

function recommendationLabel(decision: Decision): string | undefined {
  if (decision.type === 'approve' && decision.recommendation) {
    const isApprove = decision.recommendation === 'approve';
    return isApprove
      ? (decision.approve_label ?? 'Approve')
      : (decision.decline_label ?? 'Decline');
  }
  if (decision.type === 'pick' && decision.recommended_option_id) {
    const opt = decision.options.find(o => o.id === decision.recommended_option_id);
    return opt?.label;
  }
  return undefined;
}

function formatRecommendationLine(decision: Decision): string | undefined {
  const label = recommendationLabel(decision);
  if (!label && decision.confidence === undefined && !decision.sources?.length) {
    return undefined;
  }

  const parts: string[] = [];
  if (label) parts.push(`Recommend: ${label}`);
  if (typeof decision.confidence === 'number') {
    parts.push(`${Math.round(decision.confidence * 100)}% confidence`);
  }
  if (decision.sources && decision.sources.length > 0) {
    parts.push(`${decision.sources.length} source${decision.sources.length === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' \u00B7 ') : undefined;
}

function systemRow(shortId: string, panelUrl: string | undefined, decisionId: string): InlineButton[][] {
  const rows: InlineButton[][] = [];
  rows.push([
    { text: '\u23F1 Defer 1h', callback_data: `dec:${shortId}:defer:1h` },
    { text: '\u23F1 Defer tomorrow', callback_data: `dec:${shortId}:defer:tomorrow` },
  ]);
  const openBtn: InlineButton = panelUrl
    ? { text: 'Open in Panel', url: `${panelUrl.replace(/\/$/, '')}/decisions/${decisionId}` }
    : { text: 'Open in Panel', callback_data: `dec:${shortId}:open` };
  rows.push([openBtn]);
  return rows;
}

function buildApproveKeyboard(decision: ApproveDecision, shortId: string, options: FormatOptions): InlineKeyboardMarkup {
  const approveLabel = clampLabel(decision.approve_label ?? 'Approve', 'Approve');
  const declineLabel = clampLabel(decision.decline_label ?? 'Decline', 'Decline');

  const approveCbSuffix = decision.recommendation === 'approve' ? ':rec' : '';
  const declineCbSuffix = decision.recommendation === 'decline' ? ':rec' : '';

  const keyboard: InlineButton[][] = [
    [
      { text: approveLabel, callback_data: `dec:${shortId}:approve${approveCbSuffix}` },
      { text: declineLabel, callback_data: `dec:${shortId}:decline${declineCbSuffix}` },
    ],
    ...systemRow(shortId, options.panelUrl, decision.id),
  ];

  return { inline_keyboard: keyboard };
}

function buildPickKeyboard(decision: PickDecision, shortId: string, options: FormatOptions): InlineKeyboardMarkup {
  const optionRows: InlineButton[][] = decision.options.map((opt, idx) => [
    {
      text: clampLabel(opt.label, `Option ${idx + 1}`),
      callback_data: `dec:${shortId}:pick:${idx}`,
    },
  ]);

  if (decision.allow_none) {
    optionRows.push([
      { text: 'None of these', callback_data: `dec:${shortId}:pick:none` },
    ]);
  }

  return {
    inline_keyboard: [...optionRows, ...systemRow(shortId, options.panelUrl, decision.id)],
  };
}

function buildAnswerKeyboard(decision: AnswerDecision, shortId: string, options: FormatOptions): InlineKeyboardMarkup {
  const rows: InlineButton[][] = [];
  if (decision.suggested_answer) {
    rows.push([{ text: '\u2728 Use suggested answer', callback_data: `dec:${shortId}:answer:s` }]);
    rows.push([{ text: '\u{1F4DD} Type a different answer', callback_data: `dec:${shortId}:answer:r` }]);
  } else {
    rows.push([{ text: '\u{1F4DD} Type an answer', callback_data: `dec:${shortId}:answer:r` }]);
  }
  return { inline_keyboard: [...rows, ...systemRow(shortId, options.panelUrl, decision.id)] };
}

export function formatDecisionMessage(decision: Decision, options: FormatOptions = {}): FormattedDecisionMessage {
  const shortId = shortenDecisionId(decision.id);
  const headerLines = formatHeaderLines(decision);

  const recLine = formatRecommendationLine(decision);
  if (recLine) {
    headerLines.push('');
    headerLines.push(recLine);
  }

  if (decision.type === 'answer' && decision.suggested_answer) {
    headerLines.push('');
    headerLines.push(`Suggested: \u201C${sanitizeText(decision.suggested_answer, 400)}\u201D`);
  }

  const text = sanitizeText(headerLines.join('\n'), MAX_MESSAGE_CHARS);

  if (decision.type === 'approve') {
    return { text, reply_markup: buildApproveKeyboard(decision, shortId, options) };
  }
  if (decision.type === 'pick') {
    return { text, reply_markup: buildPickKeyboard(decision, shortId, options) };
  }
  return { text, reply_markup: buildAnswerKeyboard(decision, shortId, options) };
}

export function parseDecisionCallback(data: string): DecisionCallback | undefined {
  if (!data || !data.startsWith('dec:')) return undefined;
  const parts = data.split(':');
  if (parts.length < 3) return undefined;
  const shortId = parts[1];
  const action = parts[2];
  if (!shortId || !action) return undefined;

  if (action === 'approve' || action === 'decline') {
    return { shortId, action };
  }

  if (action === 'pick') {
    const ord = parts[3];
    if (ord === 'none') return { shortId, action: 'pick', ordinal: null };
    const n = parseInt(ord ?? '', 10);
    if (Number.isNaN(n) || n < 0 || n > 20) return undefined;
    return { shortId, action: 'pick', ordinal: n };
  }

  if (action === 'answer') {
    if (parts[3] === 's') return { shortId, action: 'answer_suggested' };
    if (parts[3] === 'r') return { shortId, action: 'answer_reply' };
    return undefined;
  }

  if (action === 'defer') {
    if (parts[3] === '1h') return { shortId, action: 'defer', duration: '1h' };
    if (parts[3] === 'tomorrow') return { shortId, action: 'defer', duration: 'tomorrow' };
    return undefined;
  }

  return undefined;
}

export type ResolvedMessageOptions = {
  source: 'telegram' | 'web' | 'ios' | 'macos' | string;
};

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    telegram: 'Telegram',
    web: 'Web',
    ios: 'iOS',
    macos: 'Agent Server',
  };
  return map[source] ?? source;
}

export function formatResolvedMessage(
  decision: Decision,
  resolution: Resolution,
  options: ResolvedMessageOptions,
): string {
  const summary = summarizeResolution(decision, resolution);
  return `\u2713 Resolved in ${sourceLabel(options.source)} \u00B7 ${summary}`;
}

function summarizeResolution(decision: Decision, resolution: Resolution): string {
  if (resolution.type === 'approve' && decision.type === 'approve') {
    return resolution.approved
      ? (decision.approve_label ?? 'Approve')
      : (decision.decline_label ?? 'Decline');
  }
  if (resolution.type === 'pick' && decision.type === 'pick') {
    if (resolution.option_id === null) return 'None of these';
    const opt = decision.options.find(o => o.id === resolution.option_id);
    return opt?.label ?? resolution.option_id;
  }
  if (resolution.type === 'answer') {
    return resolution.text.length > 80 ? `${resolution.text.slice(0, 77)}\u2026` : resolution.text;
  }
  if (resolution.type === 'defer') {
    return `Deferred until ${resolution.defer_until}`;
  }
  return 'Resolved';
}
