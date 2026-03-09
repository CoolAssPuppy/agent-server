import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LABEL = 'com.agent-server.daemon';
const PLIST_FILENAME = `${LABEL}.plist`;

type PlistOptions = {
  cliPath: string;
  logsDir?: string;
};

type InstallOptions = {
  cliPath: string;
  targetDir?: string;
  logsDir?: string;
};

export function generatePlist(options: PlistOptions): string {
  const logsDir = options.logsDir ?? join(homedir(), '.agent-server', 'logs');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${options.cliPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logsDir}/agent-server.log</string>
  <key>StandardErrorPath</key>
  <string>${logsDir}/agent-server.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

export function installLaunchAgent(options: InstallOptions): string {
  const targetDir = options.targetDir ?? join(homedir(), 'Library', 'LaunchAgents');
  mkdirSync(targetDir, { recursive: true });

  const plistPath = join(targetDir, PLIST_FILENAME);
  const plist = generatePlist({
    cliPath: options.cliPath,
    logsDir: options.logsDir,
  });

  writeFileSync(plistPath, plist, 'utf-8');
  return plistPath;
}

export function uninstallLaunchAgent(targetDir?: string): void {
  const dir = targetDir ?? join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = join(dir, PLIST_FILENAME);

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }
}
