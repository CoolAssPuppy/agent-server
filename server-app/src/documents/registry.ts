import { createHash } from 'node:crypto';
import { readFileSync, statSync, type Stats } from 'node:fs';
import { extname } from 'node:path';
import {
  DocumentError,
  type DocumentExtractor,
  type DocumentSource,
  type ExtractedDocument,
} from './extractor.js';
import { DocxExtractor } from './docx-extractor.js';

const DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export type DocumentRead = {
  readonly path: string;
  readonly extractor: string;
  /** SHA-256 of the source file, so a later run can tell it apart from an edit. */
  readonly sha256: string;
  readonly bytes: number;
  readonly modifiedAt: string;
  readonly text: string;
  readonly metadata: Record<string, string | number>;
};

export type DocumentExtractorRegistryOptions = {
  readonly extractors?: readonly DocumentExtractor[];
  readonly maxSourceBytes?: number;
};

/**
 * Resolves a file to the extractor that claims its extension, reads it once,
 * and hands back text plus the hash of the bytes that produced it.
 *
 * One read covers both the hash and the parse, so the hash always describes the
 * text returned with it. Two reads could straddle an edit and report a hash for
 * a file the caller never saw.
 */
export class DocumentExtractorRegistry {
  private readonly extractors: readonly DocumentExtractor[];
  private readonly maxSourceBytes: number;

  constructor(options: DocumentExtractorRegistryOptions = {}) {
    this.extractors = options.extractors ?? builtInExtractors();
    this.maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  }

  /** Every extension any registered extractor claims, for error messages. */
  supportedExtensions(): string[] {
    return [...new Set(this.extractors.flatMap((extractor) => extractor.extensions))];
  }

  extractorFor(path: string): DocumentExtractor | undefined {
    const extension = extname(path).toLowerCase();
    return this.extractors.find((extractor) => extractor.extensions.includes(extension));
  }

  async read(path: string): Promise<DocumentRead> {
    const extractor = this.extractorFor(path);
    if (!extractor) {
      throw new DocumentError(
        'unsupported_type',
        `No extractor can open ${extname(path) || 'that file'}. Supported: ${this.supportedExtensions().join(', ')}.`,
      );
    }

    const stats = statOrThrow(path);
    if (stats.size > this.maxSourceBytes) {
      throw new DocumentError(
        'too_large',
        `The file is ${stats.size} bytes and the limit is ${this.maxSourceBytes}.`,
      );
    }

    const bytes = readOrThrow(path);
    const extracted = await extractSafely(extractor, { path, bytes });
    return {
      path,
      extractor: extractor.name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      modifiedAt: stats.mtime.toISOString(),
      text: extracted.text,
      metadata: extracted.metadata ?? {},
    };
  }
}

/** The array a new format is appended to. Nothing else changes. */
function builtInExtractors(): DocumentExtractor[] {
  return [new DocxExtractor()];
}

export function createDocumentExtractorRegistry(): DocumentExtractorRegistry {
  return new DocumentExtractorRegistry({ extractors: builtInExtractors() });
}

async function extractSafely(
  extractor: DocumentExtractor,
  source: DocumentSource,
): Promise<ExtractedDocument> {
  try {
    return await extractor.extract(source);
  } catch (error) {
    throw new DocumentError(
      'unreadable',
      `The ${extractor.name} extractor could not read the file: ${(error as Error).message}`,
    );
  }
}

function statOrThrow(path: string): Stats {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) throw new Error('not a file');
    return stats;
  } catch {
    throw new DocumentError('not_found', 'There is no readable file at that path.');
  }
}

function readOrThrow(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new DocumentError('not_found', `The file could not be read: ${(error as Error).message}`);
  }
}
