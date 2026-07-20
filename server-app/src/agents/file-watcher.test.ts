import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createTempDir, makeAgent } from '../test-factories.js';
import { AgentFileWatchManager, FileWatcher } from './file-watcher.js';

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

  it('treats regular-expression metacharacters in globs as literal characters', async () => {
    const dir = createTempDir('watcher');
    dirs.push(dir);
    const literalMatch = join(dir, 'report[1](+).md');
    const regexLookalike = join(dir, 'report1.md');
    writeFileSync(literalMatch, 'initial');
    writeFileSync(regexLookalike, 'initial');

    const onChange = vi.fn();
    const watcher = new FileWatcher({
      watches: [{ path: dir, agentId: 'literal-agent', glob: 'report[1](+).md' }],
      onChange,
      debounceMs: 25,
    });
    watchers.push(watcher);

    expect(() => watcher.start()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 75));
    onChange.mockClear();
    writeFileSync(regexLookalike, 'changed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).not.toHaveBeenCalled();

    writeFileSync(literalMatch, 'changed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).toHaveBeenCalledWith('literal-agent', literalMatch);
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

describe('AgentFileWatchManager', () => {
  const dirs: string[] = [];
  const managers: AgentFileWatchManager[] = [];

  afterEach(() => {
    for (const manager of managers) manager.stop();
    managers.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('reconciles watched paths when an agent definition changes', async () => {
    const root = createTempDir('watch-manager');
    const agentsDir = join(root, 'agents');
    const firstWatchDir = join(root, 'first');
    const secondWatchDir = join(root, 'second');
    dirs.push(root);
    mkdirSync(agentsDir);
    mkdirSync(firstWatchDir);
    mkdirSync(secondWatchDir);
    const firstFile = join(firstWatchDir, 'note.md');
    const secondFile = join(secondWatchDir, 'note.md');
    writeFileSync(firstFile, 'initial');
    writeFileSync(secondFile, 'initial');

    const definitionPath = join(agentsDir, 'watcher.yaml');
    const writeDefinition = (watchPath: string): void => {
      writeFileSync(definitionPath, [
        'id: dynamic-watcher',
        'name: Dynamic Watcher',
        'prompt: Watch files.',
        'watch:',
        `  - path: "${watchPath}"`,
        '    glob: "*.md"',
      ].join('\n'));
    };
    writeDefinition(firstWatchDir);

    const onChange = vi.fn();
    const onReconcile = vi.fn();
    const manager = new AgentFileWatchManager({
      agentsDir,
      onChange,
      onReconcile,
      debounceMs: 25,
      definitionDebounceMs: 25,
    });
    managers.push(manager);
    await manager.start();
    expect(onReconcile).toHaveBeenCalledWith(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    writeFileSync(firstFile, 'first change');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('dynamic-watcher', firstFile));

    writeDefinition(secondWatchDir);
    await vi.waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 100));
    onChange.mockClear();
    writeFileSync(firstFile, 'ignored change');
    writeFileSync(secondFile, 'second change');

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('dynamic-watcher', secondFile));
    expect(onChange).not.toHaveBeenCalledWith('dynamic-watcher', firstFile);
  });

  it('subscribes before its initial snapshot so startup definition edits are reconciled', async () => {
    const root = createTempDir('watch-manager-race');
    const agentsDir = join(root, 'agents');
    const firstWatchDir = join(root, 'first');
    const secondWatchDir = join(root, 'second');
    dirs.push(root);
    mkdirSync(agentsDir);
    mkdirSync(firstWatchDir);
    mkdirSync(secondWatchDir);
    const definitionPath = join(agentsDir, 'watcher.yaml');
    const firstFile = join(firstWatchDir, 'note.md');
    const secondFile = join(secondWatchDir, 'note.md');
    writeFileSync(definitionPath, 'initial');
    writeFileSync(firstFile, 'initial');
    writeFileSync(secondFile, 'initial');

    let resolveInitial: (() => void) | undefined;
    const initialSnapshot = new Promise<ReturnType<typeof makeAgent>[]>((resolve) => {
      resolveInitial = () => resolve([
        makeAgent({
          id: 'dynamic-watcher',
          watch: [{ path: firstWatchDir, glob: '*.md' }],
        }),
      ]);
    });
    const discover = vi.fn()
      .mockImplementationOnce(() => initialSnapshot)
      .mockResolvedValue([
        makeAgent({
          id: 'dynamic-watcher',
          watch: [{ path: secondWatchDir, glob: '*.md' }],
        }),
      ]);
    const onChange = vi.fn();
    const manager = new AgentFileWatchManager({
      agentsDir,
      discoverAgents: discover,
      onChange,
      debounceMs: 25,
      definitionDebounceMs: 25,
    });
    managers.push(manager);

    const starting = manager.start();
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
    writeFileSync(definitionPath, 'changed during startup');
    resolveInitial?.();
    await starting;
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 100));

    writeFileSync(firstFile, 'ignored');
    writeFileSync(secondFile, 'observed');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('dynamic-watcher', secondFile));
    expect(onChange).not.toHaveBeenCalledWith('dynamic-watcher', firstFile);
  });
});
