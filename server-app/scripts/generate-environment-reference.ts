import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderEnvironmentReferenceTable } from '../src/platform/environment-reference.js';

const readmePath = resolve(import.meta.dirname, '../../README.md');
const readme = await readFile(readmePath, 'utf-8');
const tablePattern = /\| Variable \| Default \| Description \|\n[\s\S]*?(?=\n\nExample)/;

if (!tablePattern.test(readme)) {
  throw new Error('README environment reference table was not found.');
}

const updated = readme.replace(tablePattern, renderEnvironmentReferenceTable());
await writeFile(readmePath, updated, 'utf-8');
