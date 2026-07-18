import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FileAgentContentRepository } from './patch-repository.js';
import { PatchConflictError } from './patch.js';
import { computeAgentContentHash } from './security-rules.js';

const content = `---
id: reader
name: Reader
---
Read notes.
`;

describe('file agent content repository', () => {
  it('replaces the current agent file only when its expected hash matches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-patches-'));
    const path = join(directory, 'custom-name.md');
    try {
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
      const repository = new FileAgentContentRepository(directory);
      expect((await repository.get('reader'))?.agent.id).toBe('reader');
      expect(await repository.list()).toHaveLength(1);
      const changed = content.replace('Read notes.', 'Read selected notes.');

      await repository.replaceIfHashMatches('reader', computeAgentContentHash(content), changed);
      expect(await readFile(path, 'utf8')).toBe(changed);
      await expect(repository.replaceIfHashMatches(
        'reader', computeAgentContentHash(content), content,
      )).rejects.toBeInstanceOf(PatchConflictError);
      expect(await readFile(path, 'utf8')).toBe(changed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores symlinks and files whose parsed identity does not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-patches-'));
    try {
      await writeFile(join(directory, 'other.md'), content.replace('id: reader', 'id: other'), 'utf8');
      const repository = new FileAgentContentRepository(directory);
      await expect(repository.read('reader')).rejects.toThrow('Agent not found');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
