import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type Pair,
} from 'yaml';
import type { Permissions } from './config.js';

type TextEdit = {
  start: number;
  end: number;
  replacement: string;
};

type FrontmatterRange = {
  yamlStart: number;
  yamlEnd: number;
  bodyStart: number;
};

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function lineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function applyTextEdits(source: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.replacement + result.slice(edit.end),
      source,
    );
}

function findPair(items: Pair[], key: string): Pair | undefined {
  return items.find((pair) => String(pair.key) === key);
}

function renderRootPair(key: string, value: unknown, newline: string): string {
  const document = new Document({ [key]: value });
  return document.toString({ lineWidth: 0 }).replaceAll('\n', newline);
}

function quotedStyle(source: string, pair: Pair): boolean | undefined {
  if (!isSeq(pair.value)) return undefined;
  for (const item of pair.value.items) {
    if (!isScalar(item) || !item.range) continue;
    return source.slice(item.range[0], item.range[1]).trimStart().startsWith('"');
  }
  return undefined;
}

function scalarText(value: string, isQuoted: boolean): string {
  return isQuoted ? JSON.stringify(value) : value;
}

function isPermissions(value: unknown): value is Permissions {
  if (typeof value !== 'object' || value === null || !('allow' in value) || !('deny' in value)) {
    return false;
  }
  return Array.isArray(value.allow) && value.allow.every((item) => typeof item === 'string')
    && Array.isArray(value.deny) && value.deny.every((item) => typeof item === 'string');
}

function renderSequencePair(
  source: string,
  pair: Pair,
  values: string[],
  fallbackQuoted: boolean,
): string {
  if (!isNode(pair.key) || !pair.key.range || !isNode(pair.value) || !pair.value.range) {
    throw new Error('The agent configuration cannot be safely edited');
  }
  const newline = lineEnding(source);
  const start = lineStart(source, pair.key.range[0]);
  const indentation = source.slice(start, pair.key.range[0]);
  if (values.length === 0) return `${indentation}${String(pair.key)}: []${newline}`;

  const quoted = quotedStyle(source, pair) ?? fallbackQuoted;
  return `${indentation}${String(pair.key)}:${newline}${values
    .map((value) => `${indentation}  - ${scalarText(value, quoted)}${newline}`)
    .join('')}`;
}

function reconcileSequence(
  source: string,
  pair: Pair,
  desired: string[],
  fallbackQuoted: boolean,
): TextEdit[] {
  if (!isNode(pair.key) || !pair.key.range || !isNode(pair.value) || !pair.value.range) {
    throw new Error('The agent configuration cannot be safely edited');
  }
  if (!isSeq(pair.value) || pair.value.srcToken?.type === 'flow-collection') {
    return [{
      start: lineStart(source, pair.key.range[0]),
      end: pair.value.range[2],
      replacement: renderSequencePair(source, pair, desired, fallbackQuoted),
    }];
  }

  const desiredSet = new Set(desired);
  const retained = new Set<string>();
  const edits: TextEdit[] = [];
  let itemPrefix: string | undefined;
  const isQuoted = quotedStyle(source, pair) ?? fallbackQuoted;

  for (const item of pair.value.items) {
    if (!isScalar(item) || !item.range || typeof item.value !== 'string') {
      throw new Error('Permission lists must contain plain tool names');
    }
    itemPrefix ??= source.slice(lineStart(source, item.range[0]), item.range[0]);
    const value = item.value;
    if (desiredSet.has(value) && !retained.has(value)) {
      retained.add(value);
      continue;
    }
    edits.push({
      start: lineStart(source, item.range[0]),
      end: item.range[2],
      replacement: '',
    });
  }

  const additions = desired.filter((value) => !retained.has(value));
  if (desired.length === 0) {
    return [{
      start: lineStart(source, pair.key.range[0]),
      end: pair.value.range[2],
      replacement: renderSequencePair(source, pair, [], isQuoted),
    }];
  }
  if (additions.length > 0) {
    const prefix = itemPrefix
      ?? `${source.slice(lineStart(source, pair.key.range[0]), pair.key.range[0])}  - `;
    const newline = lineEnding(source);
    edits.push({
      start: pair.value.range[2],
      end: pair.value.range[2],
      replacement: additions.map((value) => `${prefix}${scalarText(value, isQuoted)}${newline}`).join(''),
    });
  }
  return edits;
}

function renderPermissionsField(source: string, pair: Pair, permissions: Permissions): string {
  if (!isNode(pair.key) || !pair.key.range || !isNode(pair.value) || !pair.value.range
      || !isMap(pair.value)) {
    return renderRootPair('permissions', permissions, lineEnding(source));
  }
  const start = lineStart(source, pair.key.range[0]);
  const end = pair.value.range[2];
  const fieldSource = source.slice(start, end);
  const document = parseDocument(fieldSource, { keepSourceTokens: true });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('The agent configuration cannot be safely edited');
  }
  const permissionsPair = findPair(document.contents.items, 'permissions');
  if (!permissionsPair || !isMap(permissionsPair.value)) {
    return renderRootPair('permissions', permissions, lineEnding(source));
  }
  const allowPair = findPair(permissionsPair.value.items, 'allow');
  const denyPair = findPair(permissionsPair.value.items, 'deny');
  if (!allowPair || !denyPair) return renderRootPair('permissions', permissions, lineEnding(source));
  const fallbackQuoted = quotedStyle(fieldSource, allowPair)
    ?? quotedStyle(fieldSource, denyPair)
    ?? false;
  return applyTextEdits(fieldSource, [
    ...reconcileSequence(fieldSource, allowPair, permissions.allow, fallbackQuoted),
    ...reconcileSequence(fieldSource, denyPair, permissions.deny, fallbackQuoted),
  ]);
}

function patchYamlMapping(source: string, writes: Map<string, unknown>): string {
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('The agent configuration cannot be safely edited');
  }
  const edits: TextEdit[] = [];
  const newline = lineEnding(source);

  for (const [key, value] of writes) {
    const pair = findPair(document.contents.items, key);
    if (!pair) {
      if (value === null || value === undefined) continue;
      const separator = source.length === 0 || source.endsWith('\n') ? '' : newline;
      edits.push({
        start: source.length,
        end: source.length,
        replacement: separator + renderRootPair(key, value, newline),
      });
      continue;
    }
    if (!isNode(pair.key) || !pair.key.range || !isNode(pair.value) || !pair.value.range) {
      throw new Error('The agent configuration cannot be safely edited');
    }
    const start = lineStart(source, pair.key.range[0]);
    if (value === null || value === undefined) {
      edits.push({ start, end: pair.value.range[2], replacement: '' });
    } else {
      edits.push({
        start,
        end: pair.value.range[2],
        replacement: key === 'permissions' && isPermissions(value)
          ? renderPermissionsField(source, pair, value)
          : renderRootPair(key, value, newline),
      });
    }
  }
  return applyTextEdits(source, edits);
}

function locateFrontmatter(content: string): FrontmatterRange | undefined {
  const opener = /^---(?:\r\n|\n)/.exec(content);
  if (!opener) return undefined;
  const yamlStart = opener[0].length;
  const remainder = content.slice(yamlStart);
  const closing = /^---[ \t]*(?:\r\n|\n|$)/m.exec(remainder);
  if (!closing || closing.index === undefined) {
    throw new Error('Frontmatter opening delimiter has no closing ---');
  }
  const yamlEnd = yamlStart + closing.index;
  return {
    yamlStart,
    yamlEnd,
    bodyStart: yamlEnd + closing[0].length,
  };
}

export function renderLosslessAgentPatch(
  content: string,
  writes: Map<string, unknown>,
  prompt: string | undefined,
): string {
  const frontmatter = locateFrontmatter(content);
  if (!frontmatter) {
    const yamlWrites = new Map(writes);
    if (prompt !== undefined) yamlWrites.set('prompt', prompt);
    return patchYamlMapping(content, yamlWrites);
  }

  const yaml = content.slice(frontmatter.yamlStart, frontmatter.yamlEnd);
  const patchedYaml = patchYamlMapping(yaml, writes);
  const beforeYaml = content.slice(0, frontmatter.yamlStart);
  const closingDelimiter = content.slice(frontmatter.yamlEnd, frontmatter.bodyStart);
  if (prompt === undefined) {
    return beforeYaml + patchedYaml + content.slice(frontmatter.yamlEnd);
  }
  const hadFinalNewline = content.endsWith('\n');
  return beforeYaml + patchedYaml + closingDelimiter + prompt + (hadFinalNewline ? '\n' : '');
}
