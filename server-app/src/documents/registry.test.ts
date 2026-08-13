import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentExtractorRegistry, DocumentExtractorRegistry } from './registry.js';
import { DocumentError, type DocumentExtractor } from './extractor.js';
import { buildDocumentXml, buildDocxArchive } from './docx-fixture.js';

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'agent-documents-'));
}

function makeManuscript(root: string, paragraphs: readonly string[], name = 'manuscript.docx'): string {
  const path = join(root, name);
  writeFileSync(path, buildDocxArchive({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': buildDocumentXml(paragraphs),
  }));
  return path;
}

function makeExtractor(overrides?: Partial<DocumentExtractor>): DocumentExtractor {
  return {
    name: 'fake',
    extensions: ['.fake'],
    extract: () => ({ text: 'fake text' }),
    ...overrides,
  };
}

describe('reading a document through the registry', () => {
  it('extracts the text of a real Word file', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['Chapter One', '', 'She counted the stars.']);
      const result = await createDocumentExtractorRegistry().read(path);

      expect(result.extractor).toBe('docx');
      expect(result.text).toBe('Chapter One\n\nShe counted the stars.');
      expect(result.metadata.paragraphs).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a content hash that changes only when the source changes', async () => {
    const root = makeWorkspace();
    try {
      const registry = createDocumentExtractorRegistry();
      const first = await registry.read(makeManuscript(root, ['One'], 'a.docx'));
      const same = await registry.read(makeManuscript(root, ['One'], 'b.docx'));
      const edited = await registry.read(makeManuscript(root, ['Two'], 'c.docx'));

      expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(same.sha256).toBe(first.sha256);
      expect(edited.sha256).not.toBe(first.sha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('decodes entities, tabs, and line breaks the way Word writes them', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'marks.docx');
      writeFileSync(path, buildDocxArchive({
        'word/document.xml': [
          '<w:document><w:body>',
          '<w:p><w:r><w:t>Ben &amp; Iris</w:t><w:tab/><w:t>said &quot;no&quot;</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>first</w:t><w:br/><w:t>second</w:t></w:r></w:p>',
          '</w:body></w:document>',
        ].join(''),
      }));

      const result = await createDocumentExtractorRegistry().read(path);

      expect(result.text).toBe('Ben & Iris\tsaid "no"\nfirst\nsecond');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves out deleted text and field instructions', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'tracked.docx');
      writeFileSync(path, buildDocxArchive({
        'word/document.xml': [
          '<w:document><w:body><w:p><w:r><w:t>Kept</w:t></w:r>',
          '<w:del><w:r><w:delText>Removed</w:delText></w:r></w:del>',
          '<w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r>',
          '</w:p></w:body></w:document>',
        ].join(''),
      }));

      const result = await createDocumentExtractorRegistry().read(path);

      expect(result.text).toBe('Kept');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names what it can open when the file type has no extractor', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'notes.pages');
      writeFileSync(path, 'not a word file');

      await expect(createDocumentExtractorRegistry().read(path)).rejects.toMatchObject({
        code: 'unsupported_type',
        message: expect.stringContaining('.docx'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a missing file as not found rather than as a read failure', async () => {
    const root = makeWorkspace();
    try {
      await expect(createDocumentExtractorRegistry().read(join(root, 'gone.docx')))
        .rejects.toMatchObject({ code: 'not_found' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a source file larger than the cap before reading it', async () => {
    const root = makeWorkspace();
    try {
      const path = makeManuscript(root, ['One']);
      const registry = new DocumentExtractorRegistry({ maxSourceBytes: 8 });

      await expect(registry.read(path)).rejects.toMatchObject({ code: 'too_large' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a file that is not a readable archive as unreadable', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'broken.docx');
      writeFileSync(path, 'PK not really a zip');

      await expect(createDocumentExtractorRegistry().read(path))
        .rejects.toMatchObject({ code: 'unreadable' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('adding an extractor to the registry', () => {
  it('claims its extensions without any change to the caller', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'notes.fake');
      writeFileSync(path, 'anything');
      const registry = new DocumentExtractorRegistry({ extractors: [makeExtractor()] });

      const result = await registry.read(path);

      expect(result.extractor).toBe('fake');
      expect(result.text).toBe('fake text');
      expect(registry.supportedExtensions()).toEqual(['.fake']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches the extension whatever case the filename uses', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'NOTES.FAKE');
      writeFileSync(path, 'anything');
      const registry = new DocumentExtractorRegistry({ extractors: [makeExtractor()] });

      await expect(registry.read(path)).resolves.toMatchObject({ extractor: 'fake' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('contains an extractor that throws instead of letting it escape', async () => {
    const root = makeWorkspace();
    try {
      const path = join(root, 'notes.fake');
      writeFileSync(path, 'anything');
      const registry = new DocumentExtractorRegistry({
        extractors: [makeExtractor({
          extract: () => { throw new Error('boom'); },
        })],
      });

      const failure = await registry.read(path).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(DocumentError);
      expect(failure).toMatchObject({ code: 'unreadable' });
      expect((failure as DocumentError).message).toContain('fake');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
