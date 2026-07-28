const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const MAX_REASON_LENGTH = 48;

/**
 * Reduces a thrown value to a coarse slug safe to send as an event property.
 *
 * Error messages in this codebase routinely carry agent ids, file paths, and
 * fragments of user prompts. None of that may leave the machine, so the message
 * is never used. A Node system error contributes its `code`; anything else
 * contributes only its class name. `EACCES` and `ZodError` are enough to tell
 * a permissions problem from a bad agent definition, and neither can name
 * anybody.
 */
export function classifyErrorReason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === 'string' && code.length > 0) return normalize(code);
    if (error.name && error.name !== 'Error') return normalize(error.name);
    return 'error';
  }
  return 'unknown';
}

function normalize(value: string): string {
  const slug = value.toLowerCase().replace(NON_ALPHANUMERIC, '_').replace(/^_+|_+$/g, '');
  return slug.slice(0, MAX_REASON_LENGTH) || 'unknown';
}
