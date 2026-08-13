import type { DocumentExtractor, DocumentSource, ExtractedDocument } from './extractor.js';
import { readZipEntry } from './zip.js';

const DOCUMENT_PART = 'word/document.xml';
const MAX_DOCUMENT_XML_BYTES = 64 * 1024 * 1024;

/**
 * Matches, in document order, the four things that carry text or a break in
 * WordprocessingML: a run of text, a tab, a line break, and the end of a
 * paragraph. Everything else in the part is formatting.
 *
 * Reading `w:t` rather than stripping tags is what keeps deleted text
 * (`w:delText`) and field instructions (`w:instrText`) out of the result: they
 * are different elements, so they are never matched in the first place.
 */
const CONTENT_PATTERN = new RegExp([
  '<(?:[a-zA-Z][\\w.-]*:)?t(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z][\\w.-]*:)?t>',
  '<(?:[a-zA-Z][\\w.-]*:)?tab\\b[^>]*>',
  '<(?:[a-zA-Z][\\w.-]*:)?br\\b[^>]*>',
  '</(?:[a-zA-Z][\\w.-]*:)?p>',
].join('|'), 'g');

/**
 * Reads .docx in process rather than handing the file to a converter.
 *
 * A .docx is a ZIP holding XML, which Node opens with `node:zlib` alone, so
 * this runs the same on every platform and adds no dependency and no
 * subprocess. Shelling out to `textutil` would have been fewer lines and would
 * have worked only on macOS.
 */
export class DocxExtractor implements DocumentExtractor {
  readonly name = 'docx';
  readonly extensions = ['.docx'] as const;

  extract(source: DocumentSource): ExtractedDocument {
    const part = readZipEntry(source.bytes, DOCUMENT_PART, MAX_DOCUMENT_XML_BYTES);
    if (!part) throw new Error(`The file has no ${DOCUMENT_PART}, so it is not a Word document.`);
    const xml = part.toString('utf8');
    return {
      text: documentText(xml),
      metadata: { paragraphs: countParagraphs(xml) },
    };
  }
}

function documentText(xml: string): string {
  const parts: string[] = [];
  for (const match of xml.matchAll(CONTENT_PATTERN)) {
    const [token, textContent] = match;
    if (textContent !== undefined) parts.push(decodeEntities(textContent));
    else if (token.startsWith('</')) parts.push('\n');
    else parts.push(token.includes('tab') ? '\t' : '\n');
  }
  // Trailing spaces are an artefact of how a run was split, never something the
  // author typed at the end of a line.
  return parts.join('').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

function countParagraphs(xml: string): number {
  return (xml.match(/<(?:[a-zA-Z][\w.-]*:)?p(?:\s[^>]*)?>/g) ?? []).length;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith('#x')) return codePoint(parseInt(body.slice(2), 16), entity);
    if (body.startsWith('#')) return codePoint(parseInt(body.slice(1), 10), entity);
    return NAMED_ENTITIES[body] ?? entity;
  });
}

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}
