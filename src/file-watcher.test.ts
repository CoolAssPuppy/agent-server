import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createTempDir } from './test-factories.js';
import { FileWatcher, type FileWatchConfig } from './file-watcher.js';

describe('FileWatcher', () => {
  const dirs: string[] = [];
  const watchers: FileWatcher[] = [];

  afterEach(() => {
    for (const w of watchers) w.stop();
    watchers.length = 0;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('triggers callback when a watched file changes', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: filePath, agentId: 'test-agent' }],
      onChange,
      debounceMs: 50,
    });
    watchers.push(watcher);
    watcher.start();

    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, 'changed');

    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).toHaveBeenCalledWith('test-agent', filePath);
  });

  it('triggers callback when a file in a watched directory changes', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    writeFileSync(join(dir, 'existing.md'), 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: dir, agentId: 'dir-agent', glob: '*.md' }],
      onChange,
      debounceMs: 50,
    });
    watchers.push(watcher);
    watcher.start();

    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(dir, 'existing.md'), 'updated');

    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).toHaveBeenCalledWith('dir-agent', expect.stringContaining('existing.md'));
  });

  it('debounces rapid changes', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: filePath, agentId: 'test-agent' }],
      onChange,
      debounceMs: 150,
    });
    watchers.push(watcher);
    watcher.start();

    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, 'change1');
    await new Promise((r) => setTimeout(r, 30));
    writeFileSync(filePath, 'change2');
    await new Promise((r) => setTimeout(r, 30));
    writeFileSync(filePath, 'change3');

    await new Promise((r) => setTimeout(r, 300));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('filters by glob pattern', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    writeFileSync(join(dir, 'notes.md'), 'initial');
    writeFileSync(join(dir, 'data.json'), 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: dir, agentId: 'md-agent', glob: '*.md' }],
      onChange,
      debounceMs: 50,
    });
    watchers.push(watcher);
    watcher.start();

    await new Promise((r) => setTimeout(r, 150));
    onChange.mockClear();

    writeFileSync(join(dir, 'data.json'), 'changed json');
    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).not.toHaveBeenCalled();

    writeFileSync(join(dir, 'notes.md'), 'changed md');
    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).toHaveBeenCalledWith('md-agent', expect.stringContaining('notes.md'));
  });

  it('stops watching when stop is called', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: filePath, agentId: 'test-agent' }],
      onChange,
      debounceMs: 50,
    });
    watchers.push(watcher);
    watcher.start();
    watcher.stop();

    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, 'changed');

    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).not.toHaveBeenCalled();
  });
});
