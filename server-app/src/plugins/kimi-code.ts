import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { Readable, Writable } from 'stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type McpServer,
  type Stream,
} from '@agentclientprotocol/sdk';
import type { AgentConfig } from '../agents/config.js';
import { buildKimiChildEnvironment } from '../agents/environment-policy.js';
import type { ExecutionResult } from '../execution/executor.js';
import type { Reporter } from '../execution/runner.js';
import { parseInteractionBlock } from '../interaction/parser.js';
import { AGENT_SERVER_VERSION } from '../version.js';
import {
  assertKimiSafety,
  createKimiFilePolicy,
  kimiAdditionalDirectories,
  kimiWorkingDirectory,
} from './kimi-code-file-policy.js';
import {
  createKimiExecutionState,
  handleKimiUpdate,
  isKimiPermissionGranted,
  kimiPermissionResponse,
  kimiPermissionToolName,
  kimiToolTraces,
  kimiToolsUsed,
} from './kimi-code-events.js';
import { resolveSavedConnectionValues } from '../connections/runtime-resolution.js';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  credentialBrokerSocketPath,
  startCredentialBroker,
  type CredentialBrokerPlan,
} from './credential-broker.js';
import { buildMcpPolicyRelayCommand } from './mcp-relay-runtime.js';

const MAX_STDERR_LENGTH = 4_000;

type KimiAcpOptions = {
  abortController?: AbortController;
  disableMcpServers?: boolean;
};

type KimiProcessOptions = KimiAcpOptions & {
  kimiExecutablePath?: string;
};

/** Run an agent through an already connected ACP stream. Exposed for protocol conformance tests. */
export async function runKimiAcpSession(
  agent: AgentConfig,
  reporter: Reporter,
  stream: Stream,
  options: KimiAcpOptions = {},
): Promise<ExecutionResult> {
  assertKimiSafety(agent);
  const startedAt = performance.now();
  const state = createKimiExecutionState();
  const filePolicy = await createKimiFilePolicy(agent);
  const mcpRuntime = options.disableMcpServers
    ? { servers: [], credentialBroker: undefined }
    : kimiMcpRuntime(agent);
  const closeCredentialBroker = await startCredentialBroker(mcpRuntime.credentialBroker);
  let negotiatedVersion: string | undefined;

  const app = client({ name: 'Agent Server' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const requestedTool = kimiPermissionToolName(params.toolCall, state);
      const response = kimiPermissionResponse(
        agent,
        params,
        requestedTool,
        options.abortController?.signal.aborted === true,
      );
      const isGranted = isKimiPermissionGranted(params, response);
      void reporter.progress(`${isGranted ? 'Allowed' : 'Blocked'} Kimi tool: ${requestedTool}`, {
        permission_granted: isGranted,
        tool: requestedTool,
      });
      return response;
    })
    .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
      const content = await filePolicy.readTextFile(params.path, params.line, params.limit);
      return { content };
    })
    .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
      await filePolicy.writeTextFile(params.path, params.content);
      return {};
    });

  const response = await app.connectWith(stream, async (context) => {
    const initialized = await context.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
      clientInfo: { name: 'Agent Server', version: AGENT_SERVER_VERSION },
    });
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Kimi Code uses unsupported ACP protocol ${initialized.protocolVersion}.`);
    }
    negotiatedVersion = initialized.agentInfo?.version ?? undefined;

    const builder = context.buildSession({
      cwd: kimiWorkingDirectory(agent),
      additionalDirectories: kimiAdditionalDirectories(agent),
      mcpServers: mcpRuntime.servers,
    });
    return builder.withSession(async (session) => {
      if (agent.model) {
        await context.request(methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: 'model',
          value: agent.model,
        });
      }

      const cancel = (): void => {
        void context.notify(methods.agent.session.cancel, { sessionId: session.sessionId });
      };
      options.abortController?.signal.addEventListener('abort', cancel, { once: true });
      try {
        void session.prompt(agent.prompt);
        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === 'stop') return message.response;
          handleKimiUpdate(message.update, state, reporter);
        }
      } finally {
        options.abortController?.signal.removeEventListener('abort', cancel);
      }
    });
  }).finally(closeCredentialBroker);

  const durationMs = Math.round(performance.now() - startedAt);
  const toolCalls = kimiToolTraces(state);
  return {
    summary: state.assistantText.trim() || 'Agent completed',
    output: {},
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
      cost_source: 'subscription-not-reported',
      duration_ms: durationMs,
      acp_protocol: PROTOCOL_VERSION,
      kimi_version: negotiatedVersion,
    },
    turnCount: 1,
    toolsUsed: kimiToolsUsed(state),
    filesRead: [...state.filesRead],
    filesWritten: [...state.filesWritten],
    commandsRun: state.commandsRun,
    interaction: parseInteractionBlock(state.assistantText),
    model: agent.model ?? 'Kimi Code',
    stopReason: response.stopReason,
    durationMs,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/** Run an agent through the user's installed Kimi Code ACP executable. */
export async function executeKimiCodeAgent(
  agent: AgentConfig,
  reporter: Reporter,
  options: KimiProcessOptions = {},
): Promise<ExecutionResult> {
  const executable = options.kimiExecutablePath;
  if (!executable) throw new Error('Kimi Code is not installed or is turned off in Settings.');

  const child = spawn(executable, ['acp'], {
    cwd: kimiWorkingDirectory(agent),
    env: buildKimiChildEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_LENGTH);
  });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  try {
    return await runKimiAcpSession(agent, reporter, stream, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|login|sign.?in/i.test(`${message}\n${stderr}`)) {
      throw new Error('Kimi Code needs you to sign in. Run `kimi login`, then try again.');
    }
    throw error;
  } finally {
    stopChild(child);
  }
}

function kimiMcpRuntime(agent: AgentConfig): {
  servers: McpServer[];
  credentialBroker: CredentialBrokerPlan | undefined;
} {
  const credentialBroker: CredentialBrokerPlan = {
    socketPath: credentialBrokerSocketPath(),
    grants: {},
  };
  const servers = Object.entries(agent.mcp_servers ?? {}).map(([name, config]) => {
    if ('command' in config) {
      const savedEnvironment = config.env
        ? resolveSavedConnectionValues(agent, name, config.env)
        : undefined;
      if (config.env && !savedEnvironment && Object.keys(config.env).length > 0) {
        throw new Error(`Kimi MCP server "${name}" contains credentials; use a saved connection`);
      }
      const relay = buildMcpPolicyRelayCommand(
        agent,
        name,
        config,
        savedEnvironment ?? {},
        credentialBroker,
      );
      if (relay) {
        return { name, command: relay.command, args: relay.args, env: [] };
      }
      if (savedEnvironment && Object.keys(savedEnvironment).length > 0) {
        const grant = randomUUID();
        credentialBroker.grants[grant] = savedEnvironment;
        return {
          name,
          command: process.execPath,
          args: [
            fileURLToPath(new URL('./mcp-credential-launcher.js', import.meta.url)),
            JSON.stringify({
              command: config.command,
              args: config.args ?? [],
              credential_broker: credentialBroker.socketPath,
              credential_grant: grant,
            }),
          ],
          env: [],
        };
      }
      return {
        name,
        command: config.command,
        args: config.args ?? [],
        env: Object.entries(config.env ?? {}).map(([variable, value]) => ({ name: variable, value })),
      };
    }
    const savedHeaders = config.headers
      ? resolveSavedConnectionValues(agent, name, config.headers)
      : undefined;
    if (config.headers && !savedHeaders && Object.keys(config.headers).length > 0) {
      throw new Error(`Kimi MCP server "${name}" contains credentials; use a saved connection`);
    }
    const relay = buildMcpPolicyRelayCommand(
      agent,
      name,
      config,
      savedHeaders ?? {},
      credentialBroker,
    );
    if (relay) {
      return { name, command: relay.command, args: relay.args, env: [] };
    }
    if (savedHeaders && Object.keys(savedHeaders).length > 0) {
      throw new Error(
        `Kimi MCP server "${name}" uses HTTP credentials that require the local credential relay`,
      );
    }
    return {
      type: config.type,
      name,
      url: config.url,
      headers: [],
    };
  });
  return {
    servers,
    credentialBroker: Object.keys(credentialBroker.grants).length > 0
      ? credentialBroker
      : undefined,
  };
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
