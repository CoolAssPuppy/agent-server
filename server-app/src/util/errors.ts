/**
 * Normalizes an unknown thrown value to a string message. `catch` binds
 * `unknown`, so this replaces the `err instanceof Error ? err.message :
 * String(err)` idiom that was repeated across the codebase.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
