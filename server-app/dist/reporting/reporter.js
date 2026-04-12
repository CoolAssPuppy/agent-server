const DEFAULT_HEARTBEAT_MS = 30_000;
const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'rejected']);
const TERMINAL_RETRY_COUNT = 3;
const TERMINAL_RETRY_BASE_MS = 500;
const DEFERRED_RETRY_COUNT = 5;
const DEFERRED_RETRY_BASE_MS = 5_000;
export class TelemetryReporter {
    config;
    heartbeatTimer = null;
    constructor(config) {
        this.config = {
            ...config,
            fetch: config.fetch ?? globalThis.fetch,
            heartbeatMs: config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
        };
    }
    async start() {
        await this.send({ state: 'working' });
        this.startHeartbeat();
    }
    async progress(message, metadata) {
        await this.send({ state: 'working', message, metadata });
    }
    async complete(executionResult) {
        console.log(`[telemetry] Sending completion for "${this.config.agentName}" to ${this.config.endpoint}`);
        this.stop();
        const accomplishments = [];
        if (executionResult.filesWritten.length > 0) {
            accomplishments.push(`Wrote ${executionResult.filesWritten.length} file(s): ${executionResult.filesWritten.join(', ')}`);
        }
        if (executionResult.commandsRun.length > 0) {
            accomplishments.push(`Ran ${executionResult.commandsRun.length} command(s)`);
        }
        if (executionResult.filesRead.length > 0) {
            accomplishments.push(`Read ${executionResult.filesRead.length} file(s)`);
        }
        await this.send({
            state: 'completed',
            result: {
                summary: executionResult.summary,
                accomplishments,
                usage: executionResult.usage,
                output: {
                    turn_count: executionResult.turnCount,
                    tools_used: executionResult.toolsUsed,
                    files_read: executionResult.filesRead,
                    files_written: executionResult.filesWritten,
                    commands_run: executionResult.commandsRun,
                },
            },
        });
    }
    async fail(error) {
        this.stop();
        await this.send({
            state: 'failed',
            error: { message: error.message },
        });
    }
    stop() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    startHeartbeat() {
        if (this.config.heartbeatMs <= 0)
            return;
        this.heartbeatTimer = setInterval(() => {
            void this.send({ state: 'working', message: 'heartbeat' });
        }, this.config.heartbeatMs);
    }
    async send(event) {
        const workerMetadata = {};
        if (this.config.serverId) {
            workerMetadata.worker_id = this.config.serverId;
        }
        if (this.config.conversationId) {
            workerMetadata.conversation_id = this.config.conversationId;
        }
        const body = {
            agent: this.config.agentName,
            timestamp: new Date().toISOString(),
            ...event,
            metadata: { ...workerMetadata, ...event.metadata },
        };
        const maxAttempts = TERMINAL_STATES.has(event.state) ? TERMINAL_RETRY_COUNT : 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await this.config.fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`,
                    },
                    body: JSON.stringify(body),
                });
                if (response.ok) {
                    console.log(`[telemetry] Successfully sent ${event.state} event for "${this.config.agentName}"`);
                    return;
                }
                console.error(`[telemetry] POST ${this.config.endpoint} returned ${response.status}: ${response.statusText}`);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[telemetry] Failed to send ${event.state} event for "${this.config.agentName}": ${message}`);
            }
            if (attempt < maxAttempts) {
                const delayMs = TERMINAL_RETRY_BASE_MS * 2 ** (attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        if (TERMINAL_STATES.has(event.state)) {
            this.scheduleDeferredRetry(body);
        }
    }
    scheduleDeferredRetry(body, attempt = 1) {
        if (attempt > DEFERRED_RETRY_COUNT) {
            console.error(`[telemetry] Abandoned ${body.state} event for "${this.config.agentName}" after all retries`);
            return;
        }
        const delayMs = DEFERRED_RETRY_BASE_MS * 2 ** (attempt - 1);
        setTimeout(async () => {
            try {
                const response = await this.config.fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`,
                    },
                    body: JSON.stringify(body),
                });
                if (response.ok)
                    return;
                console.error(`[telemetry] Deferred retry ${attempt} for ${body.state}: ${response.status}`);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[telemetry] Deferred retry ${attempt} for ${body.state}: ${message}`);
            }
            this.scheduleDeferredRetry(body, attempt + 1);
        }, delayMs);
    }
}
//# sourceMappingURL=reporter.js.map