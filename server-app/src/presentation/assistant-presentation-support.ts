import { basename } from 'node:path';
import type { PresentationStatement } from './models.js';

export function evidenceStatement(
  text: string,
  ...evidenceReferences: string[]
): PresentationStatement {
  return { text, evidenceReferences };
}

export function displayPath(path: string): string {
  if (path === '~' || path.endsWith('/')) return path.replace(/\/+$/, '') || path;
  return basename(path) || path;
}
