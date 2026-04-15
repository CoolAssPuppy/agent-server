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
  // Panel-side stale threshold is 90s. 20s gives ~4.5x buffer so a single
  // dropped heartbeat (wifi roam, VPN reconnect) does not cause a false
  // stale-failure on the panel.
  heartbeatMs: z.number().int().positive().default(20_000),
  port: z.number().int().positive().default(47821),
  host: z.string().default('127.0.0.1'),
  telegramBotToken: z.string().optional(),
  /**
   * Optional pinned Telegram chat ID. When set, only this chat is allowed to
   * pair via `/start` and all callbacks from other chats are ignored.
   */
  telegramAllowedChatId: z.number().int().optional(),
  apiKey: z.string().min(16).optional(),
  catchUp: z.boolean().default(false),
  maxConcurrentRuns: z.number().int().positive().default(8),
  maxWebSocketClients: z.number().int().positive().default(100),
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
    host: env.AGENT_SERVER_HOST || undefined,
    telegramBotToken: env.AGENT_SERVER_TELEGRAM_BOT_TOKEN || undefined,
    telegramAllowedChatId: env.AGENT_SERVER_TELEGRAM_CHAT_ID
      ? Number(env.AGENT_SERVER_TELEGRAM_CHAT_ID)
      : undefined,
    apiKey: env.AGENT_SERVER_API_KEY || undefined,
    catchUp: env.AGENT_SERVER_CATCH_UP === 'true',
    maxConcurrentRuns: env.AGENT_SERVER_MAX_CONCURRENT_RUNS
      ? Number(env.AGENT_SERVER_MAX_CONCURRENT_RUNS)
      : undefined,
    maxWebSocketClients: env.AGENT_SERVER_MAX_WS_CLIENTS
      ? Number(env.AGENT_SERVER_MAX_WS_CLIENTS)
      : undefined,
  });
}
