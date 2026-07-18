import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';

/**
 * Load `~/.agent-server/.env.local` and `.env`, layered under `existing`
 * (shell env). Precedence: existing > .env.local > .env, so secrets the app
 * writes to `.env.local` (e.g. connection keys from the Connect flow) override
 * the general `.env`, and both defer to real shell/Doppler env. Missing files
 * are skipped.
 */
export function loadEnvFile(
  dir: string,
  existing: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const merged = { ...existing };
  // .env.local first so its values win over .env (each file only fills keys
  // still undefined in `merged`).
  for (const filename of ['.env.local', '.env']) {
    const envPath = join(dir, filename);
    if (!existsSync(envPath)) continue;
    const fileVars = parseDotenv(readFileSync(envPath, 'utf-8'));
    for (const [key, value] of Object.entries(fileVars)) {
      if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

export const ServerConfigSchema = z.object({
  agentsDir: z.string().default(() => join(homedir(), '.agent-server', 'agents')),
  lockDir: z.string().default(() => join(homedir(), '.agent-server', 'locks')),
  logsDir: z.string().default(() => join(homedir(), '.agent-server', 'logs')),
  // Local SQLite database for durable run history. Survives restarts so the
  // macOS app's run history no longer depends on the panel. `:memory:` keeps
  // runs ephemeral (useful for throwaway/test servers).
  runDbPath: z.string().default(() => join(homedir(), '.agent-server', 'runs.db')),
  panelUrl: z.string().url().optional(),
  panelApiKey: z.string().optional(),
  checkIntervalMs: z.number().int().positive().default(60_000),
  // Panel-side stale threshold is 90s. 60s gives a 1.5x buffer so a single
  // dropped heartbeat (wifi roam, VPN reconnect) does not cause a false
  // stale-failure on the panel, while keeping panel chatter low.
  heartbeatMs: z.number().int().positive().default(60_000),
  telemetryProgressMode: z.enum(['live', 'batched']).default('live'),
  telemetryProgressSampleMs: z.number().int().positive().default(5_000),
  telemetryProgressMaxEntries: z.number().int().positive().default(50),
  telemetryProgressIncludeMetadata: z.boolean().default(false),
  port: z.number().int().positive().default(47821),
  host: z.string().default('127.0.0.1'),
  telegramBotToken: z.string().optional(),
  /**
   * Optional pinned Telegram chat ID. When set, only this chat is allowed to
   * pair via `/start` and all callbacks from other chats are ignored.
   */
  telegramAllowedChatId: z.number().int().optional(),
  /** Slack bot token (xoxb-…): drives the Web API for sending messages. */
  slackBotToken: z.string().optional(),
  /** Slack app-level token (xapp-…): opens the Socket Mode connection. */
  slackAppToken: z.string().optional(),
  apiKey: z.string().min(16).optional(),
  catchUp: z.boolean().default(false),
  maxConcurrentRuns: z.number().int().positive().default(8),
  maxWebSocketClients: z.number().int().positive().default(100),
  // Default wall-clock timeout applied to every run that does not declare its
  // own `timeout` field. 30 minutes covers every sample agent; agents with
  // legitimate long-running workloads can override per-agent via the
  // `timeout` field in YAML. Set to 0 or a negative value via env to disable.
  runTimeoutMs: z.number().int().default(30 * 60 * 1000),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return ServerConfigSchema.parse({
    agentsDir: env.AGENT_SERVER_AGENTS_DIR,
    lockDir: env.AGENT_SERVER_LOCK_DIR,
    logsDir: env.AGENT_SERVER_LOGS_DIR,
    runDbPath: env.AGENT_SERVER_RUN_DB || undefined,
    panelUrl: env.AGENT_SERVER_PANEL_URL || undefined,
    panelApiKey: env.AGENT_SERVER_PANEL_API_KEY || undefined,
    checkIntervalMs: env.AGENT_SERVER_CHECK_INTERVAL_MS
      ? Number(env.AGENT_SERVER_CHECK_INTERVAL_MS)
      : undefined,
    heartbeatMs: env.AGENT_SERVER_HEARTBEAT_MS
      ? Number(env.AGENT_SERVER_HEARTBEAT_MS)
      : undefined,
    telemetryProgressMode: env.AGENT_SERVER_TELEMETRY_PROGRESS_MODE || undefined,
    telemetryProgressSampleMs: env.AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS
      ? Number(env.AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS)
      : undefined,
    telemetryProgressMaxEntries: env.AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES
      ? Number(env.AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES)
      : undefined,
    telemetryProgressIncludeMetadata: env.AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA === 'true'
      ? true
      : undefined,
    port: env.AGENT_SERVER_PORT
      ? Number(env.AGENT_SERVER_PORT)
      : undefined,
    host: env.AGENT_SERVER_HOST || undefined,
    telegramBotToken: env.AGENT_SERVER_TELEGRAM_BOT_TOKEN || undefined,
    telegramAllowedChatId: env.AGENT_SERVER_TELEGRAM_CHAT_ID
      ? Number(env.AGENT_SERVER_TELEGRAM_CHAT_ID)
      : undefined,
    // Accept both the AGENT_SERVER_-prefixed names (consistent with the rest of
    // our config) and the bare SLACK_* names (Slack's own convention, and what
    // users typically already keep in Doppler/.env).
    slackBotToken: env.AGENT_SERVER_SLACK_BOT_TOKEN || env.SLACK_BOT_TOKEN || undefined,
    slackAppToken: env.AGENT_SERVER_SLACK_APP_TOKEN || env.SLACK_APP_TOKEN || undefined,
    apiKey: env.AGENT_SERVER_API_KEY || undefined,
    catchUp: env.AGENT_SERVER_CATCH_UP === 'true',
    maxConcurrentRuns: env.AGENT_SERVER_MAX_CONCURRENT_RUNS
      ? Number(env.AGENT_SERVER_MAX_CONCURRENT_RUNS)
      : undefined,
    maxWebSocketClients: env.AGENT_SERVER_MAX_WS_CLIENTS
      ? Number(env.AGENT_SERVER_MAX_WS_CLIENTS)
      : undefined,
    runTimeoutMs: env.AGENT_SERVER_RUN_TIMEOUT_MS
      ? Number(env.AGENT_SERVER_RUN_TIMEOUT_MS)
      : undefined,
  });
}
