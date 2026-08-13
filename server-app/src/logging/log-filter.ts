export const MAX_MESSAGE_LENGTH = 500;
export const MAX_DATA_FIELDS = 20;
export const MAX_DATA_VALUE_LENGTH = 500;

export type FilterableLogInput = {
  message: string;
  body?: string;
  data?: Record<string, unknown>;
};

export type FilteredLogInput = {
  message: string;
  body?: string;
  data?: Record<string, string | number | boolean>;
};

// CSI (ESC [ … final byte), OSC (ESC ] … BEL or ST), and any other two-byte
// escape. A viewer that renders these can be made to erase or repaint lines,
// which is how a forged entry hides a real one.
// Matching control characters is the whole job here.
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
// C0 and C1 control characters. Tab and newline survive in a body; a message is
// flattened to one line separately.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Cleans what an agent asked to log before any of it reaches disk.
 *
 * An agent that read untrusted content may be repeating an attacker's text. The
 * entry is data, never instructions, and this keeps it that way: no escape
 * sequences to repaint a terminal, no control characters, and a message that
 * cannot span lines and pose as a second entry. Identity fields are applied by
 * the store afterwards, so nothing here can claim to be another agent.
 */
export function filterLogInput(input: FilterableLogInput): FilteredLogInput {
  return {
    message: clean(input.message, { singleLine: true }).slice(0, MAX_MESSAGE_LENGTH),
    ...(input.body !== undefined ? { body: clean(input.body, { singleLine: false }) } : {}),
    ...(input.data !== undefined ? { data: cleanData(input.data) } : {}),
  };
}

function clean(value: string, options: { singleLine: boolean }): string {
  const withoutEscapes = value.replace(ANSI_SEQUENCE, '');
  const stripped = options.singleLine
    ? withoutEscapes.replace(/[\r\n\t]+/g, ' ')
    : withoutEscapes.replace(/\r\n?/g, '\n');
  const safe = stripped.replace(CONTROL_CHARACTERS, '');
  // A body is a document the run wanted kept, so it survives byte for byte
  // apart from what could forge a viewer. Only the one-line fields are trimmed.
  return options.singleLine ? safe.trim() : safe;
}

function cleanData(data: Record<string, unknown>): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Object.keys(cleaned).length >= MAX_DATA_FIELDS) break;
    const safeKey = clean(key, { singleLine: true }).slice(0, 60);
    if (safeKey.length === 0) continue;
    if (typeof value === 'string') {
      cleaned[safeKey] = clean(value, { singleLine: true }).slice(0, MAX_DATA_VALUE_LENGTH);
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      cleaned[safeKey] = value;
    }
  }
  return cleaned;
}
