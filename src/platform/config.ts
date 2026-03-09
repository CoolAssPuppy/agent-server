import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';

export function loadEnvFile(
  dir: string,
  existing: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) {
    return { ...existing };
  }
  const fileVars = parseDotenv(readFileSync(envPath, 'utf-8'));
  const merged = { ...existing };
  for (const [key, value] of Object.entries(fileVars)) {
    if (merged[key] === undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export const ServerConfigSchema = z.object({
  agentsDir: z.string().default(() => join(homedir(), '.agent-server', 'agents')),
  lockDir: z.string().default(() => join(homedir(), '.agent-server', 'locks')),
  logsDir: z.string().default(() => join(homedir(), '.agent-server', 'logs')),
  panelUrl: z.string().url().optional(),
  panelApiKey: z.string().optional(),
  checkIntervalMs: z.number().int().positive().default(60_000),
  heartbeatMs: z.number().int().positive().default(30_000),
  port: z.number().int().positive().default(47821),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return ServerConfigSchema.parse({
    agentsDir: env.AGENT_SERVER_AGENTS_DIR,
    lockDir: env.AGENT_SERVER_LOCK_DIR,
    logsDir: env.AGENT_SERVER_LOGS_DIR,
    panelUrl: env.AGENT_SERVER_PANEL_URL || undefined,
    panelApiKey: env.AGENT_SERVER_PANEL_API_KEY || undefined,
    checkIntervalMs: env.AGENT_SERVER_CHECK_INTERVAL_MS
      ? Number(env.AGENT_SERVER_CHECK_INTERVAL_MS)
      : undefined,
    heartbeatMs: env.AGENT_SERVER_HEARTBEAT_MS
      ? Number(env.AGENT_SERVER_HEARTBEAT_MS)
      : undefined,
    port: env.AGENT_SERVER_PORT
      ? Number(env.AGENT_SERVER_PORT)
      : undefined,
  });
}
