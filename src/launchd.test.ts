import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generatePlist, installLaunchAgent, uninstallLaunchAgent } from './launchd.js';

function createTempDir(): string {
  const dir = join(tmpdir(), `launchd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('generatePlist', () => {
  it('generates valid plist XML with program path', () => {
    const plist = generatePlist({ cliPath: '/usr/local/bin/agent-server' });
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('com.agent-server.daemon');
    expect(plist).toContain('/usr/local/bin/agent-server');
    expect(plist).toContain('<string>start</string>');
  });

  it('includes RunAtLoad as true', () => {
    const plist = generatePlist({ cliPath: '/usr/local/bin/agent-server' });
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
  });

  it('includes KeepAlive as true', () => {
    const plist = generatePlist({ cliPath: '/usr/local/bin/agent-server' });
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<true/>');
  });

  it('includes log paths', () => {
    const plist = generatePlist({
      cliPath: '/usr/local/bin/agent-server',
      logsDir: '/tmp/logs',
    });
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('/tmp/logs/agent-server.log');
    expect(plist).toContain('<key>StandardErrorPath</key>');
    expect(plist).toContain('/tmp/logs/agent-server.err');
  });
});

describe('installLaunchAgent', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('writes the plist to the target directory', () => {
    const dir = createTempDir();
    dirs.push(dir);

    installLaunchAgent({
      cliPath: '/usr/local/bin/agent-server',
      targetDir: dir,
    });

    const plistPath = join(dir, 'com.agent-server.daemon.plist');
    expect(existsSync(plistPath)).toBe(true);

    const content = readFileSync(plistPath, 'utf-8');
    expect(content).toContain('agent-server');
  });
});

describe('uninstallLaunchAgent', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('removes the plist file', () => {
    const dir = createTempDir();
    dirs.push(dir);

    installLaunchAgent({ cliPath: '/usr/local/bin/agent-server', targetDir: dir });
    const plistPath = join(dir, 'com.agent-server.daemon.plist');
    expect(existsSync(plistPath)).toBe(true);

    uninstallLaunchAgent(dir);
    expect(existsSync(plistPath)).toBe(false);
  });

  it('does not throw when plist does not exist', () => {
    const dir = createTempDir();
    dirs.push(dir);

    expect(() => uninstallLaunchAgent(dir)).not.toThrow();
  });
});
