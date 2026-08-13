/**
 * Abstract contract for one document format.
 *
 * To add a format — .pdf, .epub, .rtf, anything — implement this interface and
 * append it to the array `createDocumentExtractorRegistry` builds. That is the
 * only edit. No call site changes and no tool schema changes, because neither
 * the tool nor the permission layer knows which formats exist.
 *
 * `extract` may throw. The registry isolates every extractor, so one that is
 * given a corrupt file reports a typed error instead of failing the run with a
 * stack trace.
 */
export interface DocumentExtractor {
  /** Stable slug reported back to the agent so it knows what read the file. */
  readonly name: string;
  /** Lowercase extensions this extractor claims, each with its leading dot. */
  readonly extensions: readonly string[];
  extract(source: DocumentSource): ExtractedDocument | Promise<ExtractedDocument>;
}

/**
 * The file, already read and size-checked by the registry.
 *
 * Both the bytes and the path are handed over: an in-process parser wants the
 * bytes it has, and an extractor that has to hand the file to something else
 * wants the path without re-deriving it.
 */
export type DocumentSource = {
  readonly path: string;
  readonly bytes: Buffer;
};

export type ExtractedDocument = {
  /** Plain text, in reading order. */
  readonly text: string;
  /** Whatever the format gives up cheaply, such as a paragraph count. */
  readonly metadata?: Record<string, string | number>;
};

export type DocumentErrorCode =
  | 'unsupported_type'
  | 'not_found'
  | 'too_large'
  | 'unreadable';

/** One typed failure the tool can turn into a sentence an agent can act on. */
export class DocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode, message: string) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}
