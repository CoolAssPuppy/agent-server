import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDocument, DOCUMENT_TEXT_LIMIT, type DocumentToolContext } from './document-tool.js';
import { createDocumentExtractorRegistry } from './registry.js';
import { createFileAccessCheck } from '../execution/permissions.js';
import { buildDocumentXml, buildDocxArchive } from './docx-fixture.js';

type ToolPayload = {
  path: string;
  sha256: string;
  extractor: string;
  characters: number;
  offset?: number;
  next_offset?: number | null;
  has_more?: boolean;
  text?: string;
  metadata?: Record<string, string | number>;
};

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'agent-document-tool-'));
}

function makeManuscript(root: string, paragraphs: readonly string[], name = 'manuscript.docx'): string {
  const path = join(root, name);
  writeFileSync(path, buildDocxArchive({ 'word/document.xml': buildDocumentXml(paragraphs) }));
  return path;
}

function makeContext(overrides?: Partial<DocumentToolContext>): DocumentToolContext {
  return {
    registry: createDocumentExtractorRegistry(),
    cwd: tmpdir(),
    ...overrides,
  };
}

function payloadOf(result: { content: Array<{ text: string }>; isError?: boolean }): ToolPayload {
  return JSON.parse(result.content[0].text) as ToolPayload;
}

describe('reading a document with the server-owned tool', () => {
  it('returns the text and a hash of the source in one call', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['Chapter One', 'She counted the stars.']);

      const result = await readDocument(makeContext(), { path });
      const payload = payloadOf(result);

      expect(result.isError).toBeUndefined();
      expect(payload.text).toBe('Chapter One\nShe counted the stars.');
      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.has_more).toBe(false);
      expect(payload.next_offset).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('pages a long manuscript instead of returning all of it', async () => {
    const root = makeWorkspace();
    try {
      const paragraphs = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} ${'word '.repeat(20)}`);
      const path = makeManuscript(root, paragraphs);

      const first = payloadOf(await readDocument(makeContext(), { path, limit: 500 }));
      const second = payloadOf(await readDocument(makeContext(), {
        path,
        offset: first.next_offset ?? 0,
        limit: 500,
      }));

      expect(first.text?.length).toBeLessThanOrEqual(500);
      expect(first.has_more).toBe(true);
      expect(first.next_offset).toBe(first.text?.length);
      expect(second.text?.startsWith('Paragraph 0')).toBe(false);
      expect(first.characters).toBeGreaterThan(1000);
      expect(first.characters).toBe(second.characters);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never returns more than the per-call cap even when asked for more', async () => {
    const root = makeWorkspace();
    try {
      const paragraphs = Array.from({ length: 4000 }, () => 'word '.repeat(40));
      const path = makeManuscript(root, paragraphs);

      const payload = payloadOf(await readDocument(makeContext(), { path, limit: 10_000_000 }));

      expect(payload.characters).toBeGreaterThan(DOCUMENT_TEXT_LIMIT);
      expect(payload.text?.length).toBeLessThanOrEqual(DOCUMENT_TEXT_LIMIT);
      expect(payload.has_more).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('answers a change check with the hash alone, without any text', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['Chapter One']);

      const payload = payloadOf(await readDocument(makeContext(), { path, metadataOnly: true }));

      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.characters).toBeGreaterThan(0);
      expect(payload.text).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an offset past the end as an empty final page', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['Chapter One']);

      const payload = payloadOf(await readDocument(makeContext(), { path, offset: 9999 }));

      expect(payload.text).toBe('');
      expect(payload.has_more).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says what it can open when handed a file type it cannot', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'notes.pages');
      writeFileSync(path, 'not a word file');

      const result = await readDocument(makeContext(), { path });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('.docx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('file access for the document tool', () => {
  it('refuses a path outside every reviewed grant', async () => {
    const root = makeWorkspace();
    try {
      const allowed = join(root, 'allowed');
      mkdirSync(allowed);
      const path = makeManuscript(root, ['Secret'], 'private.docx');

      const result = await readDocument(makeContext({
        cwd: root,
        canAccessFile: createFileAccessCheck({
          cwd: root,
          fileAccess: [{ path: allowed, kind: 'folder', access: 'read_only' }],
        }),
      }), { path });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('access');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads a file a read_only grant covers', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['Chapter One']);

      const result = await readDocument(makeContext({
        cwd: root,
        canAccessFile: createFileAccessCheck({
          cwd: root,
          fileAccess: [{ path, kind: 'file', access: 'read_only' }],
        }),
      }), { path });

      expect(result.isError).toBeUndefined();
      expect(payloadOf(result).text).toBe('Chapter One');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a path that climbs out of its grant', async () => {
    const root = makeWorkspace();
    try {
      const allowed = join(root, 'allowed');
      mkdirSync(allowed);
      makeManuscript(root, ['Secret'], 'private.docx');

      const result = await readDocument(makeContext({
        cwd: root,
        canAccessFile: createFileAccessCheck({
          cwd: root,
          fileAccess: [{ path: allowed, kind: 'folder', access: 'read_only' }],
        }),
      }), { path: join(allowed, '..', 'private.docx') });

      expect(result.isError).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
