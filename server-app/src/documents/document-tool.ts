import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { canonicalFileAccessPath, type FileAccessCheck } from '../execution/permissions.js';
import { DocumentError } from './extractor.js';
import type { DocumentExtractorRegistry } from './registry.js';
import { AGENT_DOCUMENT_SERVER_NAME } from './tool-name.js';

export { AGENT_DOCUMENT_READ_TOOL_NAME, AGENT_DOCUMENT_SERVER_NAME } from './tool-name.js';

/** Characters one call may return. A manuscript is read a page at a time. */
export const DOCUMENT_TEXT_LIMIT = 50_000;
const DEFAULT_TEXT_LIMIT = 20_000;

const TOOL_DESCRIPTION = [
  'Read a document the Read tool cannot open, such as a Word .docx file.',
  'Returns plain text plus a sha256 of the source file, so a later run can tell',
  'an edited document from an unchanged one without running any command.',
  'Long documents come back a page at a time: pass the returned next_offset to continue.',
  'Pass metadataOnly to get the hash and length without any text.',
  'The path must be inside a folder or file this agent has been granted.',
].join(' ');

export type DocumentToolContext = {
  registry: DocumentExtractorRegistry;
  /** Base for relative paths, matching the run's working directory. */
  cwd: string;
  /** The agent's reviewed grants, when it has any. */
  canAccessFile?: FileAccessCheck;
};

export type DocumentReadInput = {
  path: string;
  offset?: number;
  limit?: number;
  metadataOnly?: boolean;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const inputShape = {
  path: z.string().min(1).describe('Path to the document. Absolute, or ~ for your home folder.'),
  offset: z.number().int().min(0).optional()
    .describe('Character to start at. Use next_offset from the previous call. Defaults to 0.'),
  limit: z.number().int().min(1).max(DOCUMENT_TEXT_LIMIT).optional()
    .describe(`Characters to return, up to ${DOCUMENT_TEXT_LIMIT}. Defaults to ${DEFAULT_TEXT_LIMIT}.`),
  metadataOnly: z.boolean().optional()
    .describe('Return the hash, size, and length without the text. Use it to check for changes.'),
};

export async function readDocument(
  context: DocumentToolContext,
  input: DocumentReadInput,
): Promise<ToolResult> {
  const path = canonicalFileAccessPath(input.path, context.cwd);
  // Second gate. The permission callback already refused a path outside the
  // grants, but this tool opens files itself, so it checks rather than trusting
  // that it was called through the callback at all.
  if (context.canAccessFile && !context.canAccessFile(path, 'read')) {
    return errorResult(`This agent has no file access covering ${input.path}.`);
  }

  try {
    const document = await context.registry.read(path);
    const summary = {
      path: document.path,
      sha256: document.sha256,
      extractor: document.extractor,
      bytes: document.bytes,
      modified_at: document.modifiedAt,
      characters: document.text.length,
      metadata: document.metadata,
    };
    if (input.metadataOnly) return jsonResult(summary);

    const page = pageOf(document.text, input.offset ?? 0, input.limit);
    return jsonResult({
      ...summary,
      offset: page.offset,
      next_offset: page.nextOffset,
      has_more: page.nextOffset !== null,
      text: page.text,
    });
  } catch (error) {
    if (error instanceof DocumentError) return errorResult(error.message);
    return errorResult(`The document could not be read: ${(error as Error).message}`);
  }
}

export function createDocumentMcpServer(context: DocumentToolContext) {
  return createSdkMcpServer({
    name: AGENT_DOCUMENT_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool('read_document', TOOL_DESCRIPTION, inputShape, async (args) => readDocument(context, {
        path: args.path,
        offset: args.offset,
        limit: args.limit,
        metadataOnly: args.metadataOnly,
      })),
    ],
  });
}

type DocumentPage = {
  offset: number;
  text: string;
  nextOffset: number | null;
};

/**
 * Cuts one page out of the text, ending on a paragraph boundary when there is
 * one. A page that stops mid-sentence reads as a document that is missing a
 * sentence, and an agent summarising it has no way to tell the difference.
 */
function pageOf(text: string, offset: number, limit: number | undefined): DocumentPage {
  const start = Math.min(offset, text.length);
  const size = Math.min(limit ?? DEFAULT_TEXT_LIMIT, DOCUMENT_TEXT_LIMIT);
  const slice = text.slice(start, start + size);
  const reachesEnd = start + slice.length >= text.length;
  const lastBreak = slice.lastIndexOf('\n');
  const page = reachesEnd || lastBreak <= 0 ? slice : slice.slice(0, lastBreak + 1);
  const nextOffset = start + page.length;
  return {
    offset: start,
    text: page,
    nextOffset: nextOffset < text.length ? nextOffset : null,
  };
}

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
